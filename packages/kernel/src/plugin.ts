import type { AnyDomainObject } from "./domain-object";
import type { AnyExtensionPoint } from "./extension-point";
import type { ObjectTypeDefinition } from "./object-type";
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
	readonly domainObjects?: readonly AnyDomainObject[];
	readonly objectTypes?: readonly ObjectTypeDefinition[];
}

/**
 * The request a window makes to main before its kernel starts: the local
 * plugins main loaded this launch, which the window loads too so both
 * kernels run the same set.
 */
export const EXTERNAL_PLUGINS_CHANNEL = "kernel:external-plugins";

/** One local plugin as a window loads it: same-origin URLs of its modules. */
export interface WindowExternalPlugin {
	readonly manifest: unknown;
	/** Module exporting its `definitions`. */
	readonly contracts?: string;
	/** Module default-exporting its window entry. */
	readonly web?: string;
}

export interface PluginRegistration {
	readonly manifest: unknown;
	readonly definitions?: PluginDefinitions;
	/** This process's entry; absent when the plugin has nothing to run here. */
	readonly entry?: PluginEntry;
	readonly source?: "bundled" | "external";
}
