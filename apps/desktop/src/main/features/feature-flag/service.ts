import { EventEmitter } from "node:events";
import type { AuthSessionService } from "../auth/auth-service.js";
import { createLogger, type Logger } from "../../platform/logger.js";
import { ANONYMOUS_CONTEXT, bindAuthToProvider, deriveContext } from "./auth-adapter.js";
import { LaunchDarklyProvider } from "./provider.js";
import type { FeatureFlagProvider } from "./types.js";

export interface CreateFeatureFlagOptions {
	auth: AuthSessionService;
	appVersion: string;
}

interface FeatureFlagServiceDeps {
	provider: FeatureFlagProvider;
	auth: AuthSessionService;
	overrides: Set<string>;
	logger: Logger;
	appVersion: string;
}

type FlagMap = Record<string, unknown>;

interface FeatureFlagServiceEvents {
	change: [flags: FlagMap];
}

function parseOverrides(raw: string | undefined): Set<string> {
	return new Set(
		(raw ?? "")
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean),
	);
}

/**
 * Provider-agnostic feature-flag service. Seeds an anonymous context, re-identifies
 * on auth changes, and swallows + logs every provider failure so a caller always
 * gets a value (the requested default). Env overrides force a flag on for dev/testing.
 *
 * Emits `change` with the full flag set whenever the provider reports a change.
 */
export class FeatureFlagService extends EventEmitter<FeatureFlagServiceEvents> {
	readonly #provider: FeatureFlagProvider;
	readonly #auth: AuthSessionService;
	readonly #overrides: Set<string>;
	readonly #logger: Logger;

	#stopAuth: (() => void) | undefined;

	private constructor(deps: FeatureFlagServiceDeps) {
		super();
		this.#provider = deps.provider;
		this.#auth = deps.auth;
		this.#overrides = deps.overrides;
		this.#logger = deps.logger;
	}

	static create(options: CreateFeatureFlagOptions): FeatureFlagService {
		const logger = createLogger("feature-flag");
		const env = import.meta.env;
		const overrides = parseOverrides(env.VITE_FEATURE_FLAG_OVERRIDES);

		const provider = new LaunchDarklyProvider({
			clientSideId: env.VITE_LAUNCHDARKLY_CLIENT_SIDE_ID ?? "",
			initialContext: ANONYMOUS_CONTEXT,
			logger,
		});

		const service = new FeatureFlagService({
			provider,
			auth: options.auth,
			overrides,
			logger,
			appVersion: options.appVersion,
		});

		service.#stopAuth = bindAuthToProvider(options.auth, provider, (cause) => {
			logger.error("Failed to re-identify feature-flag context on auth change", cause);
		});

		provider.on("change", () => {
			service.emit("change", service.getAllFlags());
		});

		return service;
	}

	async initialize(): Promise<void> {
		try {
			const context = await deriveContext(this.#auth);
			await this.#provider.identify(context);
			await this.#provider.start();
			this.emit("change", this.getAllFlags());
		} catch (cause) {
			this.#logger.error("Feature-flag initialization failed", cause);
		}
	}

	getFlag<T>(key: string, defaultValue?: T): T {
		// TODO: the old Eppo integration emitted a FEATURE_FLAG_EVALUATION event
		// on every evaluation. Re-add evaluation logging here once the telemetry
		// approach is decided (telemetry service is currently out of scope).
		if (this.#overrides.has(key)) {
			return true as T;
		}
		try {
			return this.#provider.getFlag<T>(key, defaultValue);
		} catch (cause) {
			this.#logger.error(`Failed to evaluate feature flag '${key}'`, cause);
			return defaultValue as T;
		}
	}

	getAllFlags(): FlagMap {
		try {
			return this.#provider.getAllFlags();
		} catch (cause) {
			this.#logger.error("Failed to read all feature flags", cause);
			return {};
		}
	}

	dispose(): Promise<void> {
		this.#stopAuth?.();
		this.#stopAuth = undefined;
		this.removeAllListeners();
		return this.#provider.dispose();
	}
}
