import { EventEmitter } from "node:events";
import path from "node:path";
import type { AuthSessionService } from "../auth/auth-service.js";
import { createLogger, type Logger } from "../../platform/logger.js";
import { ANONYMOUS_CONTEXT, bindAuthToProvider, deriveContext } from "./auth-adapter.js";
import { LaunchDarklyProvider } from "./provider.js";
import type { FeatureFlagProvider } from "./types.js";

export interface CreateFeatureFlagOptions {
	auth: AuthSessionService;
	appVersion: string;
	/** Electron `userData` dir; the provider's flag cache lives under it. */
	storageRoot: string;
}

interface FeatureFlagServiceDeps {
	provider: FeatureFlagProvider;
	auth: AuthSessionService;
	overrides: Set<string>;
	logger: Logger;
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

		const clientSideId = env.VITE_LAUNCHDARKLY_CLIENT_SIDE_ID ?? "";
		if (!clientSideId) {
			logger.warn(
				"No LaunchDarkly client-side ID configured (VITE_LAUNCHDARKLY_CLIENT_SIDE_ID); flags will resolve to defaults.",
			);
		} else {
			// Fingerprint (not the whole ID) so we can confirm which LD env the
			// app booted against without leaking the credential to log files.
			const fingerprint = `${clientSideId.slice(0, 4)}…${clientSideId.slice(-4)}`;
			logger.info(`LaunchDarkly client-side ID configured (${fingerprint}).`);
		}

		const provider = new LaunchDarklyProvider({
			clientSideId,
			initialContext: ANONYMOUS_CONTEXT,
			appVersion: options.appVersion,
			storagePath: path.join(options.storageRoot, "launchdarkly"),
			logger,
		});

		const service = new FeatureFlagService({
			provider,
			auth: options.auth,
			overrides,
			logger,
		});

		// bindAuthToProvider re-identifies the provider on later login/logout
		// transitions; initialize() (below, called by the shell) seeds the
		// boot-time context. They don't overlap — do not "dedupe" them.
		service.#stopAuth = bindAuthToProvider(options.auth, provider, (cause) => {
			logger.error("Failed to re-identify feature-flag context on auth change", cause);
		});

		provider.on("change", () => {
			service.emit("change", service.getAllFlags());
		});

		return service;
	}

	/**
	 * Boot-time context seed: derive the initial context and identify the
	 * provider once at startup. Subsequent login/logout transitions are handled
	 * by bindAuthToProvider (wired in create()) — the two are distinct entry
	 * points and are intentionally not deduplicated.
	 */
	async initialize(): Promise<void> {
		try {
			const context = await deriveContext(this.#auth);
			await this.#provider.identify(context);
			this.emit("change", this.getAllFlags());
		} catch (cause) {
			this.#logger.error("Feature-flag initialization failed", cause);
		}
	}

	getFlag<T>(key: string, defaultValue?: T): T {
		// TODO: re-add FEATURE_FLAG_EVALUATION telemetry (the old Eppo
		// integration emitted it per evaluation) once getFlag() has a real
		// caller — it currently has none, only getAllFlags() is used.
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
		let flags: FlagMap;
		try {
			flags = this.#provider.getAllFlags();
		} catch (cause) {
			this.#logger.error("Failed to read all feature flags", cause);
			flags = {};
		}
		// Overlay overrides so the renderer's useFeatureFlag (which reads this
		// map) sees them too, mirroring getFlag()'s override decision.
		for (const key of this.#overrides) {
			flags[key] = true;
		}
		return flags;
	}

	dispose(): Promise<void> {
		this.#stopAuth?.();
		this.#stopAuth = undefined;
		this.removeAllListeners();
		return this.#provider.dispose();
	}
}
