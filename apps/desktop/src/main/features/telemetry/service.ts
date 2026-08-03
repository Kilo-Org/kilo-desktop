import type { TelemetryTrackInput } from "@anaconda-agentic-desktop/contracts";

import { createLogger } from "../../platform/logger.js";
import { AuthSessionTelemetryAdapter, type AuthSessionSlice } from "./auth-adapter.js";
import { AnacondaOtelProvider } from "./provider.js";
import type {
	AnonymizeOption,
	TelemetryAuthAdapter,
	TelemetryConfig,
	TelemetryEntry,
	TelemetryEvent,
	TelemetryLogger,
	TelemetryProvider,
} from "./types.js";

/** Preference/config surface the service reads per event. */
export interface TelemetryPreferences {
	readonly allowDataCollection: boolean;
	getInstallationId(): string;
}

export interface CreateTelemetryOptions {
	auth: AuthSessionSlice;
	preferences: TelemetryPreferences;
	appVersion: string;
	/** OTEL resource `service_id` / service name. */
	serviceId: string;
}

interface TelemetryServiceDeps {
	provider: TelemetryProvider;
	auth: TelemetryAuthAdapter;
	preferences: TelemetryPreferences;
	logger: TelemetryLogger;
	appVersion: string;
}

/** Reads telemetry endpoint/config from `import.meta.env.VITE_ANACONDA_LOGGING_*`. */
function telemetryConfigFromEnv(serviceId: string, serviceVersion: string): TelemetryConfig {
	const env = import.meta.env;
	const exportInterval = Number.parseInt(env.VITE_ANACONDA_LOGGING_EXPORT_INTERVAL_MS ?? "", 10);
	return {
		serviceId,
		serviceVersion,
		...(env.VITE_ANACONDA_LOGGING_AUTH_URL ? { authUrl: env.VITE_ANACONDA_LOGGING_AUTH_URL } : {}),
		...(env.VITE_ANACONDA_LOGGING_NON_AUTH_URL
			? { nonAuthUrl: env.VITE_ANACONDA_LOGGING_NON_AUTH_URL }
			: {}),
		...(Number.isFinite(exportInterval) ? { exportIntervalMs: exportInterval } : {}),
		...(env.VITE_ANACONDA_LOGGING_ENV_ATTRIBUTE
			? { environmentAttribute: env.VITE_ANACONDA_LOGGING_ENV_ATTRIBUTE }
			: {}),
	};
}

/**
 * Provider-agnostic telemetry service. Gates on `allowDataCollection`, resolves
 * identity via the auth adapter, assembles a {@link TelemetryEntry}, and hands it
 * to the provider. All failures are swallowed + logged so telemetry never breaks
 * a caller.
 */
export class TelemetryService {
	readonly #provider: TelemetryProvider;
	readonly #auth: TelemetryAuthAdapter;
	readonly #preferences: TelemetryPreferences;
	readonly #logger: TelemetryLogger;
	readonly #appVersion: string;

	private constructor(deps: TelemetryServiceDeps) {
		this.#provider = deps.provider;
		this.#auth = deps.auth;
		this.#preferences = deps.preferences;
		this.#logger = deps.logger;
		this.#appVersion = deps.appVersion;
	}

	/** Assemble the telemetry stack: auth adapter → OTEL provider → service. */
	static create(options: CreateTelemetryOptions): TelemetryService {
		const adapter = new AuthSessionTelemetryAdapter({ auth: options.auth });
		const provider = new AnacondaOtelProvider({
			auth: adapter,
			config: telemetryConfigFromEnv(options.serviceId, options.appVersion),
		});
		return new TelemetryService({
			provider,
			auth: adapter,
			preferences: options.preferences,
			logger: createLogger("telemetry"),
			appVersion: options.appVersion,
		});
	}

	/** Build a service with explicit dependencies; for tests. */
	static withDependencies(
		deps: Partial<TelemetryServiceDeps> &
			Pick<TelemetryServiceDeps, "provider" | "auth" | "preferences">,
	): TelemetryService {
		return new TelemetryService({
			logger: deps.logger ?? createLogger("telemetry"),
			appVersion: deps.appVersion ?? "0.0.0",
			...deps,
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
			const identity = await this.#auth.getIdentity(anonymize);

			const entry: TelemetryEntry = {
				event: input.event as TelemetryEvent,
				data: { ...input.data },
				installationId: this.#preferences.getInstallationId(),
				isEmployee: identity.isEmployee,
			};
			if (identity.userId !== undefined) entry.userId = identity.userId;
			if (identity.cohortId !== undefined) entry.cohortId = identity.cohortId;
			if (identity.subscription !== undefined) entry.subscription = identity.subscription;

			await this.#provider.send(entry);
		} catch (cause) {
			this.#logger.error(`Failed to send telemetry event '${input.event}'`, cause);
		}
	}

	async dispose(): Promise<void> {
		await this.#provider.dispose();
	}
}
