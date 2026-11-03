import { manifestSchema, ownerOf, type PluginEntry, type QualifiedId } from "@kilo-desktop/kernel";

import type { BundledPlugin } from "./registrations";

/** One plugin taken out of a bundled set, with every plugin that cannot run without it. */
export interface PluginRemoval {
	readonly removed: string;
	/** `removed` plus the plugins that `requires` its items as `required`, transitively. */
	readonly removedIds: readonly string[];
	readonly remaining: readonly BundledPlugin[];
}

function idOf(plugin: BundledPlugin): string | undefined {
	const parsed = manifestSchema.safeParse(plugin.manifest);
	return parsed.success ? parsed.data.id : undefined;
}

function requiredOwners(plugin: BundledPlugin): string[] {
	const parsed = manifestSchema.safeParse(plugin.manifest);
	if (!parsed.success) return [];
	return Object.entries(parsed.data.requires ?? {})
		.filter(([, strength]) => strength === "required")
		.map(([item]) => ownerOf(item as QualifiedId));
}

/**
 * For each plugin in `plugins`, the set left when it is removed (principle 5:
 * removing any plugin leaves the app booting). Optional requirements never
 * take a plugin out; `required` ones do, transitively.
 */
export function pluginRemovals(plugins: readonly BundledPlugin[]): PluginRemoval[] {
	const ids = plugins.map(idOf).filter((id): id is string => id !== undefined);
	return ids.map((removed) => {
		const gone = new Set([removed]);
		let grew = true;
		while (grew) {
			grew = false;
			for (const plugin of plugins) {
				const id = idOf(plugin);
				if (id === undefined || gone.has(id)) continue;
				if (requiredOwners(plugin).some((owner) => gone.has(owner))) {
					gone.add(id);
					grew = true;
				}
			}
		}
		return {
			removed,
			removedIds: [...gone],
			remaining: plugins.filter((plugin) => !gone.has(idOf(plugin) ?? "")),
		};
	});
}

/** A process's entry map without the entries of removed plugins. */
export function entriesWithout(
	entries: Readonly<Record<string, PluginEntry>>,
	removedIds: readonly string[],
): Record<string, PluginEntry> {
	return Object.fromEntries(Object.entries(entries).filter(([id]) => !removedIds.includes(id)));
}
