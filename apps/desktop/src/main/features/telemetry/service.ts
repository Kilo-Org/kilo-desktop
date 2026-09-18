import type { AuthSession, TelemetryTrackInput } from "@kilo-desktop/contracts";

import { createLogger } from "../../platform/logger.js";
import { isAnacondaEmployee, primarySubscriptionFromAttributes } from "../auth/utils.js";
import { AnacondaOtelProvider } from "./provider.js";
import { calculatePeriodId } from "./utils.js";
import type {
	AnonymizeOption,
	TelemetryAuth,
	TelemetryConfig,
	TelemetryEntry,
	TelemetryIdentity,
	TelemetryLogger,
	TelemetryProvider,
} from "./types.js";

/** Preference/config surface the service reads per event. */
export interface TelemetryPreferences {
	readonly allowDataCollection: boolean;
	getInstallationId(): string;
}

export interface CreateTelemetryOptions {
	auth: TelemetryAuth;
	preferences: TelemetryPreferences;
	appVersion: string;
	/** OTEL resource `service_id` / service name. */
	serviceId: string;
}

export interface TelemetryServiceOptions {
	provider: TelemetryProvider;
	auth: TelemetryAuth;
	preferences: TelemetryPreferences;
	appVersion: string;
	logger?: TelemetryLogger;
}

const ANONYMOUS_IDENTITY: TelemetryIdentity = { isEmployee: false };

/** Reads telemetry endpoint/config from `import.meta.env.VITE_ANACONDA_LOGGING_*`. */
function telemetryConfigFromEnv(serviceId: string, serviceVersion: string): TelemetryConfig {
	const {
		VITE_ANACONDA_LOGGING_AUTH_URL,
		VITE_ANACONDA_LOGGING_NON_AUTH_URL,
		VITE_ANACONDA_LOGGING_EXPORT_INTERVAL_MS,
		VITE_ANACONDA_LOGGING_ENV_ATTRIBUTE,
	} = import.meta.env;

	const config: TelemetryConfig = { serviceId, serviceVersion };
	if (VITE_ANACONDA_LOGGING_AUTH_URL) config.authUrl = VITE_ANACONDA_LOGGING_AUTH_URL;
	if (VITE_ANACONDA_LOGGING_NON_AUTH_URL) config.nonAuthUrl = VITE_ANACONDA_LOGGING_NON_AUTH_URL;

	const exportInterval = Number.parseInt(VITE_ANACONDA_LOGGING_EXPORT_INTERVAL_MS ?? "", 10);
	if (Number.isFinite(exportInterval)) config.exportIntervalMs = exportInterval;

	if (VITE_ANACONDA_LOGGING_ENV_ATTRIBUTE) {
		config.environmentAttribute = VITE_ANACONDA_LOGGING_ENV_ATTRIBUTE;
	}
	return config;
}

/**
 * Derives telemetry identity from the auth session. `anonymize: "always"`, an
 * anonymous/error session, or any read failure yields the anonymous identity;
 * never throws. Subscription is resolved from userinfo attributes and omitted on
 * failure. Relies on `AuthSessionService` to memoize session/userinfo reads.
 */
export async function deriveTelemetryIdentity(
	auth: TelemetryAuth,
	anonymize: AnonymizeOption,
	logger: TelemetryLogger = createLogger("telemetry"),
): Promise<TelemetryIdentity> {
	// NOTE: "if-not-logged-in" currently behaves identically to "never"; it will
	// diverge when we implement not establishing/refreshing a session for it.
	if (anonymize === "always") return ANONYMOUS_IDENTITY;

	let session: AuthSession;
	try {
		session = await auth.getSession();
	} catch {
		return ANONYMOUS_IDENTITY;
	}
	if (session.status !== "authenticated") return ANONYMOUS_IDENTITY;

	const identity: TelemetryIdentity = {
		isEmployee: isAnacondaEmployee(session.user.email),
		cohortId: calculatePeriodId(),
	};
	if (session.user.userId !== undefined) identity.userId = session.user.userId;

	try {
		identity.subscription = primarySubscriptionFromAttributes(await auth.getUserInfo());
	} catch (cause) {
		// Subscription is non-critical; omit it on failure.
		logger.warn("telemetry: failed to resolve subscription", cause);
	}

	return identity;
}

/**
 * Provider-agnostic telemetry service. Gates on `allowDataCollection`, resolves
 * identity from the auth session, assembles a {@link TelemetryEntry}, and hands
 * it to the provider. All failures are swallowed + logged so telemetry never
 * breaks a caller.
 */
export class TelemetryService {
	readonly #provider: TelemetryProvider;
	readonly #auth: TelemetryAuth;
	readonly #preferences: TelemetryPreferences;
	readonly #logger: TelemetryLogger;
	readonly #appVersion: string;

	constructor(options: TelemetryServiceOptions) {
		this.#provider = options.provider;
		this.#auth = options.auth;
		this.#preferences = options.preferences;
		this.#logger = options.logger ?? createLogger("telemetry");
		this.#appVersion = options.appVersion;
	}

	/** Assemble the telemetry stack: auth → OTEL provider → service. */
	static create(options: CreateTelemetryOptions): TelemetryService {
		const provider = new AnacondaOtelProvider({
			auth: options.auth,
			config: telemetryConfigFromEnv(options.serviceId, options.appVersion),
		});
		return new TelemetryService({
			provider,
			auth: options.auth,
			preferences: options.preferences,
			appVersion: options.appVersion,
		});
	}

	async initialize(): Promise<void> {
		await this.track({
			event: "DESKTOP_INITIALIZED",
			data: {
				timestamp: Date.now(),
				version: this.#appVersion,
				platform: process.platform,
			},
		});
	}

	async track(input: TelemetryTrackInput): Promise<void> {
		try {
			if (!this.#preferences.allowDataCollection) return;

			const anonymize: AnonymizeOption = input.options?.anonymize ?? "never";
			const identity = await deriveTelemetryIdentity(this.#auth, anonymize, this.#logger);

			const entry: TelemetryEntry = {
				...identity,
				event: input.event,
				data: input.data,
				installationId: this.#preferences.getInstallationId(),
			};

			await this.#provider.track(entry);
		} catch (cause) {
			this.#logger.error(`Failed to send telemetry event '${input.event}'`, cause);
		}
	}

	async dispose(): Promise<void> {
		await this.#provider.dispose();
	}
}
