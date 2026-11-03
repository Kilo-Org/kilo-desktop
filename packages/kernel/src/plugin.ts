import type { AnyDomain } from "./domain";
import type { AnyExtensionPoint } from "./extension-point";
import type { PluginSdk } from "./sdk";

/**
 * A plugin entry for one process. The kernel awaits `activate` (with a time
 * budget) and `deactivate`; everything registered through `sdk` is disposed
 * automatically on deactivation, so `deactivate` is rarely needed.
 */
export interface PluginEntry {
	activate(sdk: PluginSdk): void | Promise<void>;
	deactivate?(): void | Promise<void>;
}

export function definePlugin(entry: PluginEntry): PluginEntry {
	return entry;
}

/** Definitions from a plugin's contracts, available without activating it. */
export interface PluginDefinitions {
	readonly extensionPoints?: readonly AnyExtensionPoint[];
	readonly domains?: readonly AnyDomain[];
}

export interface PluginRegistration {
	readonly manifest: unknown;
	readonly definitions?: PluginDefinitions;
	/** This process's entry; absent when the plugin has nothing to run here. */
	readonly entry?: PluginEntry;
	readonly source?: "bundled" | "external";
}
