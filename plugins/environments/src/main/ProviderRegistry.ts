import type { EnvironmentProvider, RegisteredProviderInfo } from "./EnvironmentProvider.js";

/**
 * In-memory registry of {@link EnvironmentProvider} implementations for one
 * `mainRegister` lifetime. v1 registers only the conda provider; adding a
 * future provider (uv, pip, …) is a `registry.register(new UvProvider())`
 * call plus a subdirectory under `src/main/providers/<id>/`.
 *
 * The registry itself is deliberately dumb — orchestration (calling `boot`,
 * `registerHandlers`, `registerTools`, and pushing metadata to the renderer)
 * lives in `mainRegister`. Keeping the registry as a plain data holder makes
 * it trivial to unit-test and to swap for a fake in integration tests.
 */
export class ProviderRegistry {
	readonly #providers = new Map<string, EnvironmentProvider>();

	/**
	 * Register a provider. Throws on duplicate id so a boot bug surfaces
	 * immediately instead of silently overwriting an existing entry.
	 */
	register(provider: EnvironmentProvider): void {
		if (this.#providers.has(provider.id)) {
			throw new Error(`[ProviderRegistry] provider "${provider.id}" is already registered.`);
		}
		this.#providers.set(provider.id, provider);
	}

	/** Whether a provider with this id has been registered. */
	has(id: string): boolean {
		return this.#providers.has(id);
	}

	/** Look up a provider by id; `undefined` when it was never registered. */
	get(id: string): EnvironmentProvider | undefined {
		return this.#providers.get(id);
	}

	/** All registered providers, in registration order. */
	list(): readonly EnvironmentProvider[] {
		return [...this.#providers.values()];
	}

	/**
	 * Serialize the registry to the shape the renderer consumes when
	 * building the provider tab strip. Skips component/handler references so
	 * the value stays structured-cloneable across the IPC boundary.
	 */
	toInfoList(): readonly RegisteredProviderInfo[] {
		return this.list().map(({ id, displayName }) => ({ id, displayName }));
	}
}
