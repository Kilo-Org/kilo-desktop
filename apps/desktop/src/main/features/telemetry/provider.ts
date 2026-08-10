import {
	changeSignalConnection,
	Configuration,
	initializeTelemetry,
	ResourceAttributes,
	sendEvent,
	type AttrMap,
} from "anaconda-opentelemetry";
import { platform, version } from "node:os";

import { createLogger } from "../../platform/logger.js";
import { singleFlight } from "../../platform/single-flight.js";
import { hashHostname, hashMachineId, hostnameId, readMachineIdFromOs } from "./utils.js";
import type {
	TelemetryConfig,
	TelemetryEntry,
	TelemetryLogger,
	TelemetryProvider,
	TelemetryProviderAuth,
} from "./types.js";

const SIGNAL_FALLBACK_URL = "http://localhost:4318/v1/logs";
const ANONYMOUS_USER_ID = "<anonymous-user>";

type OTelState = "uninitialized" | "initialized-no-user" | "initialized-with-user";

export interface AnacondaOtelProviderOptions {
	auth: TelemetryProviderAuth;
	config: TelemetryConfig;
	logger?: TelemetryLogger;
}

/**
 * OTEL-specific telemetry provider and sole importer of `anaconda-opentelemetry`.
 * Preserves the correctness-critical parts of the ported anaconda-desktop
 * service: single-flight lazy init, the
 * `uninitialized`/`initialized-no-user`/`initialized-with-user` state machine,
 * and re-init on API-key change.
 */
export class AnacondaOtelProvider implements TelemetryProvider {
	readonly #auth: TelemetryProviderAuth;
	readonly #config: TelemetryConfig;
	readonly #logger: TelemetryLogger;
	readonly #resources: ResourceAttributes;

	#otelState: OTelState = "uninitialized";
	#needToReinitialize = false;
	#lastApiKey: string | undefined;
	#machineHash: string | undefined;
	#stopOnChanged: (() => void) | undefined;

	/** Lazily created on the first `track` so concurrent sends share one init. */
	#initOnce: (() => Promise<void>) | undefined;

	constructor(options: AnacondaOtelProviderOptions) {
		this.#auth = options.auth;
		this.#config = options.config;
		this.#logger = options.logger ?? createLogger("telemetry");
		this.#resources = new ResourceAttributes(this.#config.serviceId, this.#config.serviceVersion);

		this.#stopOnChanged = this.#auth.onChanged(() => {
			this.#needToReinitialize = true;
		});
	}

	async track(entry: TelemetryEntry): Promise<void> {
		try {
			if (this.#otelState === "uninitialized") {
				this.#initOnce ??= singleFlight(() => this.#initializeOtel(entry));
				await this.#initOnce();
				this.#otelState = entry.userId ? "initialized-with-user" : "initialized-no-user";
				this.#logger.info(`OTEL initialized to state '${this.#otelState}'`);
			} else if (this.#otelState === "initialized-no-user") {
				this.#needToReinitialize = true;
			}

			// Order matters: probe first so a change is captured even when a re-init
			// was already queued.
			this.#needToReinitialize = (await this.#checkForNewApiKey()) || this.#needToReinitialize;
			if (this.#needToReinitialize) {
				await this.#reInitializeOtel(entry);
				this.#needToReinitialize = false;
			}

			const attributes: AttrMap = {};
			if (entry.subscription) attributes.subscription = entry.subscription;
			if (entry.cohortId !== undefined) attributes.cohortId = entry.cohortId;
			if (entry.isEmployee) attributes.is_anaconda_employee = true;

			const ok = sendEvent({ eventName: entry.event, payload: entry.data, attributes });
			if (!ok) {
				this.#logger.error(`OTEL failed to send telemetry event '${entry.event}'`);
			} else {
				this.#logger.debug(`OTEL telemetry event '${entry.event}' sent`);
			}
		} catch (cause) {
			this.#logger.error(`OTEL failed to send telemetry event '${entry.event}'`, cause);
		}
	}

	async dispose(): Promise<void> {
		this.#stopOnChanged?.();
		this.#stopOnChanged = undefined;
	}

	async #checkForNewApiKey(): Promise<boolean> {
		const key = (await this.#auth.getApiKey()) ?? undefined;
		if (key === this.#lastApiKey) return false;
		this.#lastApiKey = key;
		this.#logger.info("OTEL API key changed, will re-initialize connection");
		return true;
	}

	async #initializeOtel(entry: TelemetryEntry): Promise<void> {
		const apiKey = (await this.#auth.getApiKey()) ?? undefined;
		this.#lastApiKey = apiKey;
		this.#logger.info(`Initializing OTEL telemetry (${apiKey ? "authenticated" : "anonymous"})`);

		const url = this.#getUrl(apiKey);
		const config = new Configuration(url, apiKey);
		if (this.#config.exportIntervalMs !== undefined) {
			config.setLoggingExportIntervalMs(this.#config.exportIntervalMs);
		}
		config.setDebugState(false);

		await this.#buildResourceAttributes(entry);
		initializeTelemetry(config, this.#resources, ["logging"]);
	}

	async #reInitializeOtel(entry: TelemetryEntry): Promise<void> {
		this.#otelState =
			!entry.userId || entry.userId === ANONYMOUS_USER_ID
				? "initialized-no-user"
				: "initialized-with-user";

		const url = this.#getUrl(this.#lastApiKey);
		await this.#buildResourceAttributes(entry);
		await changeSignalConnection("logging", {
			endpoint: url,
			...(this.#lastApiKey ? { authToken: this.#lastApiKey } : {}),
			...(entry.userId ? { userId: entry.userId } : {}),
		});
		this.#logger.debug(`OTEL re-initialized to state '${this.#otelState}' (${url.href})`);
	}

	#getUrl(token: string | undefined): URL {
		const configured = token ? this.#config.authUrl : this.#config.nonAuthUrl;
		const urlStr = configured && configured !== "" ? configured : SIGNAL_FALLBACK_URL;
		if (urlStr === SIGNAL_FALLBACK_URL) {
			this.#logger.warn(
				`OTEL logging URL not set (${token ? "auth" : "non-auth"}); defaulting to '${SIGNAL_FALLBACK_URL}'`,
			);
		}
		return new URL(urlStr);
	}

	async #buildResourceAttributes(entry: TelemetryEntry): Promise<void> {
		const parameters: AttrMap = {
			machineId: await this.#getMachineHash(),
			service_id: this.#config.serviceId,
		};
		if (entry.cohortId !== undefined) parameters.cohortId = entry.cohortId;
		if (entry.isEmployee) parameters.is_anaconda_employee = true;
		if (entry.subscription) parameters.subscription = entry.subscription;

		this.#resources.setAttributes({
			osType: platform(),
			osVersion: version(),
			nodeVersion: process.version.slice(1),
			hostname: hashHostname(),
			userId: entry.userId,
			installationId: entry.installationId,
			environment: this.#config.environmentAttribute || "staging",
			platform: "desktop-gui",
			parameters,
		});
	}

	async #getMachineHash(): Promise<string> {
		if (this.#machineHash === undefined) {
			const raw = await readMachineIdFromOs().catch(() => hostnameId());
			this.#machineHash = hashMachineId(raw);
		}
		return this.#machineHash;
	}
}
