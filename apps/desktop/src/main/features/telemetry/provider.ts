import {
	changeSignalConnection,
	Configuration,
	initializeTelemetry,
	ResourceAttributes,
	sendEvent,
	type AttrMap,
} from "anaconda-opentelemetry";
import isEqual from "lodash/isEqual.js";
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

/** Effective OTEL connection identity; re-init happens only when this changes. */
interface Connection {
	apiKey: string | undefined;
	userId: string | undefined;
}

/** Identity-derived OTEL attributes shared by event payloads and the resource. */
function identityAttributes(entry: TelemetryEntry): AttrMap {
	const attrs: AttrMap = {};
	if (entry.subscription) attrs.subscription = entry.subscription;
	if (entry.cohortId !== undefined) attrs.cohortId = entry.cohortId;
	if (entry.isEmployee) attrs.is_anaconda_employee = true;
	return attrs;
}

export interface AnacondaOtelProviderOptions {
	auth: TelemetryProviderAuth;
	config: TelemetryConfig;
	logger?: TelemetryLogger;
}

/**
 * OTEL-specific telemetry provider and sole importer of `anaconda-opentelemetry`.
 * Preserves the correctness-critical parts of the ported anaconda-desktop
 * service: single-flight lazy init and re-init on connection change. The
 * connection is re-initialized only when the effective identity
 * (`{ apiKey, userId }`) changes or an auth `onChanged` event fired — repeated
 * sends with an unchanged identity reuse the existing connection.
 */
export class AnacondaOtelProvider implements TelemetryProvider {
	readonly #auth: TelemetryProviderAuth;
	readonly #config: TelemetryConfig;
	readonly #logger: TelemetryLogger;
	readonly #resources: ResourceAttributes;

	#lastConnection: Connection | undefined;
	#authChanged = false;
	#machineHash: string | undefined;
	#stopOnChanged: (() => void) | undefined;

	constructor(options: AnacondaOtelProviderOptions) {
		this.#auth = options.auth;
		this.#config = options.config;
		this.#logger = options.logger ?? createLogger("telemetry");
		this.#resources = new ResourceAttributes(this.#config.serviceId, this.#config.serviceVersion);

		this.#stopOnChanged = this.#auth.onChanged(() => {
			this.#authChanged = true;
		});
	}

	#initialize = singleFlight(
		async (entry: TelemetryEntry, apiKey: string | undefined): Promise<void> => {
			this.#logger.info(`Initializing OTEL telemetry (${apiKey ? "authenticated" : "anonymous"})`);

			const url = this.#getUrl(apiKey);
			const config = new Configuration();
			// 0.9.3 dropped constructor/default endpoints; logging never starts
			// unless the signal-specific setter is used (otherwise sendEvent
			// prints "### ERROR: No Logger!!!").
			config.setLoggingEndpoint(url, apiKey);
			if (this.#config.exportIntervalMs !== undefined) {
				config.setLoggingExportIntervalMs(this.#config.exportIntervalMs);
			}
			config.setDebugState(false);

			await this.#buildResourceAttributes(entry);
			initializeTelemetry(config, this.#resources, ["logging"]);
		},
	);

	#reInitialize = singleFlight(
		async (entry: TelemetryEntry, apiKey: string | undefined): Promise<void> => {
			const url = this.#getUrl(apiKey);
			await this.#buildResourceAttributes(entry);
			await changeSignalConnection("logging", {
				endpoint: url,
				...(apiKey ? { authToken: apiKey } : {}),
				...(entry.userId ? { userId: entry.userId } : {}),
			});
			this.#logger.debug(`OTEL re-initialized connection (${url.href})`);
		},
	);

	async track(entry: TelemetryEntry): Promise<void> {
		try {
			const apiKey = (await this.#auth.getApiKey()) ?? undefined;
			const next: Connection = { apiKey, userId: entry.userId };

			if (this.#lastConnection === undefined) {
				await this.#initialize(entry, apiKey);
			} else if (this.#authChanged || !isEqual(this.#lastConnection, next)) {
				await this.#reInitialize(entry, apiKey);
			}
			this.#lastConnection = next;
			this.#authChanged = false;

			const ok = sendEvent({
				eventName: entry.event,
				payload: entry.data,
				attributes: identityAttributes(entry),
			});
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
			...identityAttributes(entry),
		};

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
