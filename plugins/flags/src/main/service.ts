import type { KernelLogger } from "@kilo-desktop/kernel";

import type { FeatureFlagContext, FeatureFlagProvider } from "./types";

export type FlagMap = Record<string, unknown>;

/** `VITE_FEATURE_FLAG_OVERRIDES=a,b` → flags forced on for development and e2e. */
export function parseOverrides(raw: string | undefined): ReadonlySet<string> {
	return new Set(
		(raw ?? "")
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean),
	);
}

/**
 * Provider-agnostic feature flags. Overrides force a flag on; every provider
 * failure is swallowed and logged so readers always get a value.
 */
export class FeatureFlagService {
	readonly #provider: FeatureFlagProvider;
	readonly #overrides: ReadonlySet<string>;
	readonly #logger: KernelLogger;

	constructor(options: {
		readonly provider: FeatureFlagProvider;
		readonly overrides: ReadonlySet<string>;
		readonly logger: KernelLogger;
	}) {
		this.#provider = options.provider;
		this.#overrides = options.overrides;
		this.#logger = options.logger;
	}

	/** Calls `listener` with every flag whenever the provider reports a change. */
	onChange(listener: (flags: FlagMap) => void): () => void {
		const relay = () => listener(this.getAllFlags());
		this.#provider.on("change", relay);
		return () => this.#provider.off("change", relay);
	}

	/** Identifies who the flags are for; resolves once the provider has answered or given up. */
	async identify(context: FeatureFlagContext): Promise<void> {
		try {
			await this.#provider.identify(context);
		} catch (cause) {
			this.#logger.error("Feature-flag identification failed", cause);
		}
	}

	getAllFlags(): FlagMap {
		let flags: FlagMap;
		try {
			flags = { ...this.#provider.getAllFlags() };
		} catch (cause) {
			this.#logger.error("Failed to read all feature flags", cause);
			flags = {};
		}
		for (const key of this.#overrides) flags[key] = true;
		return flags;
	}

	dispose(): Promise<void> {
		this.#provider.removeAllListeners("change");
		return this.#provider.dispose();
	}
}
