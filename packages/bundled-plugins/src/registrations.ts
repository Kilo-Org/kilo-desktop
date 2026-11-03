import {
	manifestSchema,
	type PluginDefinitions,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";

/** A bundled plugin's process-agnostic parts: its manifest and contracts definitions. */
export interface BundledPlugin {
	readonly manifest: unknown;
	readonly definitions?: PluginDefinitions;
	/**
	 * Ships no window entry. Main reads this to refuse window calls that claim
	 * the plugin, since main can't see the renderer's entry map.
	 */
	readonly mainOnly?: true;
}

function idOf(plugin: BundledPlugin): string | undefined {
	const id = (plugin.manifest as { id?: unknown } | null)?.id;
	return typeof id === "string" ? id : undefined;
}

/**
 * Registrations for one process: every bundled plugin, with that process's
 * entry attached where it has one. An entry for an unknown plugin is a wiring
 * mistake, so it fails loudly at startup.
 */
export function withEntries(
	entries: Readonly<Record<string, PluginEntry>>,
	plugins: readonly BundledPlugin[],
): PluginRegistration[] {
	const ids = new Set(plugins.map(idOf));
	for (const id of Object.keys(entries)) {
		if (!ids.has(id)) throw new Error(`Plugin entry "${id}" has no bundled manifest.`);
	}
	return plugins.map((plugin) => {
		const id = idOf(plugin);
		const entry = id === undefined ? undefined : entries[id];
		return {
			manifest: plugin.manifest,
			...(plugin.definitions ? { definitions: plugin.definitions } : {}),
			source: "bundled" as const,
			...(entry ? { entry } : {}),
		};
	});
}

/** Ids of plugins with a window entry: the only plugins a window may call main as. */
export function webPluginIds(plugins: readonly BundledPlugin[]): string[] {
	return plugins.flatMap((plugin) => {
		const id = idOf(plugin);
		return id !== undefined && !plugin.mainOnly ? [id] : [];
	});
}

/** URL schemes declared by valid manifests; registered before the app is ready. */
export function protocolSchemes(plugins: readonly BundledPlugin[]): string[] {
	return plugins.flatMap((plugin) => {
		const parsed = manifestSchema.safeParse(plugin.manifest);
		return parsed.success ? (parsed.data.permissions?.protocols ?? []) : [];
	});
}
