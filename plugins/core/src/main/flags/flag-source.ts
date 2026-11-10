import type { FlagSource, FlagValue, IdentityState, KernelLogger } from "@kilo-desktop/kernel";

import { contextFor } from "./context";
import type { FeatureFlagContext, FeatureFlagProvider } from "./types";

/**
 * LaunchDarkly as the kernel's flag source. The kernel calls `identify`
 * whenever `kernel/identity` changes, from activation on; the provider is
 * only asked once the `launchdarkly` daemon has started it (`start`), which
 * identifies whoever is current then. Later identities are passed on only
 * when the derived context differs (a refresh of the same account is not a
 * new identity). `values()` stays null until LaunchDarkly has answered —
 * the daemon started, or the SDK reported values (e.g. from its cache) —
 * then reports every boolean, string or number flag. Every provider failure
 * is logged and swallowed so the kernel always gets an answer.
 */
export class LaunchDarklyFlagSource implements FlagSource {
	readonly #provider: FeatureFlagProvider;
	readonly #logger: KernelLogger;
	readonly #listeners = new Set<() => void>();
	#context: FeatureFlagContext | undefined;
	#identified: string | undefined;
	#started = false;
	#answered = false;

	constructor(options: { readonly provider: FeatureFlagProvider; readonly logger: KernelLogger }) {
		this.#provider = options.provider;
		this.#logger = options.logger;
		this.#provider.on("change", () => {
			this.#answered = true;
			this.#notify();
		});
	}

	values(): Readonly<Record<string, FlagValue>> | null {
		if (!this.#answered) return null;
		let all: Record<string, unknown>;
		try {
			all = this.#provider.getAllFlags();
		} catch (cause) {
			this.#logger.error("Failed to read all feature flags", cause);
			return {};
		}
		return Object.fromEntries(
			Object.entries(all).filter(([, value]) => isFlagValue(value)),
		) as Record<string, FlagValue>;
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	async identify(identity: IdentityState): Promise<void> {
		this.#context = contextFor(identity);
		if (this.#started) await this.#identifyCurrent();
	}

	/** Starts LaunchDarkly for the current identity; resolves once it has answered or given up. */
	async start(): Promise<void> {
		this.#started = true;
		await this.#identifyCurrent();
		this.#answered = true;
		this.#notify();
	}

	dispose(): Promise<void> {
		this.#listeners.clear();
		this.#provider.removeAllListeners("change");
		return this.#provider.dispose();
	}

	async #identifyCurrent(): Promise<void> {
		const context = this.#context ?? contextFor({ primary: null, linked: [] });
		const key = JSON.stringify(context);
		if (key === this.#identified) return;
		this.#identified = key;
		try {
			await this.#provider.identify(context);
		} catch (cause) {
			this.#logger.error("Feature-flag identification failed", cause);
		}
	}

	#notify(): void {
		for (const listener of this.#listeners) listener();
	}
}

function isFlagValue(value: unknown): value is FlagValue {
	return typeof value === "boolean" || typeof value === "string" || typeof value === "number";
}
