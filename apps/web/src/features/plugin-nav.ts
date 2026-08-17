import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ComponentType } from "react";

import {
	pluginNav,
	stripPluginNamespace,
	type PluginDiscovery,
} from "@anaconda-agentic-desktop/feature-sdk";
import { useFeatureSystem } from "@anaconda-agentic-desktop/sdk-react";

/**
 * A sidebar nav entry declared in a plugin manifest (`contributes.nav`).
 * Pure data — the shell renders it as a link without touching plugin code.
 * `to` is the full resolved path (already prefixed with `/plugins/`); the
 * sidebar links through the catch-all route (`/plugins/$`).
 */
export interface PluginNavEntry {
	pluginId: string;
	/** Full resolved destination path, e.g. "/plugins/todos". */
	to: string;
	label: string;
	/** Lucide icon name (kebab-case), if declared and not resolved to a component. */
	icon: string | undefined;
	/**
	 * Resolved icon component exported by the plugin's web entry module.
	 * Takes priority over the `icon` string when present.
	 */
	iconComponent: ComponentType | undefined;
	/** Higher renders first. */
	priority: number;
	/**
	 * `to` with the `/plugins/` prefix stripped — the catch-all route's splat
	 * param (e.g. `"todos"` for `/plugins/todos`).
	 */
	splat: string;
	/** Stable test id for the nav entry, e.g. "nav-todos". */
	navQaId: string;
	/**
	 * Optional LaunchDarkly feature-flag key gating the entry's visibility.
	 * When set and the flag resolves to `false` the sidebar omits the entry.
	 * Consumed by {@link filterVisiblePluginNav}. Mirrors the manifest field
	 * on `pluginNavEntrySchema` — see feature-sdk's `manifest.ts` for the
	 * authoritative semantics.
	 */
	featureFlag: string | undefined;
}

/** Derive sidebar nav entries from a discovery result, priority-ordered (pure). */
export function buildPluginNav(discovery: PluginDiscovery): PluginNavEntry[] {
	return pluginNav(discovery)
		.map((entry) => {
			const splat = stripPluginNamespace(entry.to);
			return {
				pluginId: entry.pluginId,
				to: entry.to,
				label: entry.label,
				icon: entry.icon,
				iconComponent: entry.iconComponent as ComponentType | undefined,
				priority: entry.priority,
				splat,
				navQaId: `nav-${splat.replaceAll("/", "-")}`,
				featureFlag: entry.featureFlag,
			};
		})
		.sort((a, b) => b.priority - a.priority);
}

/**
 * Filter a set of nav entries against the current feature-flag map. Entries
 * without a `featureFlag` are always visible; entries whose gating flag
 * resolves to a truthy value are also visible. Everything else is omitted.
 *
 * Kept pure so the sidebar can compose it with {@link buildPluginNav} inside
 * a `useSyncExternalStore` selector without re-running discovery.
 */
export function filterVisiblePluginNav(
	entries: readonly PluginNavEntry[],
	flags: Record<string, unknown>,
): PluginNavEntry[] {
	return entries.filter((entry) => {
		if (entry.featureFlag === undefined) return true;
		return Boolean(flags[entry.featureFlag]);
	});
}

/**
 * Subscribe to the feature-flag store and return the subset of `entries`
 * whose gating flag (if any) is truthy right now. Re-renders only when a
 * flag referenced by one of the entries actually changes value.
 *
 * Concretely: on every relevant flag change, `useSyncExternalStore`
 * publishes a new `signature` (a joined "key=0|key=1" string). The
 * `useMemo` below reads `featureFlags.peek()` and re-derives the filtered
 * list. Entries without a `featureFlag` are always retained.
 */
export function useVisiblePluginNav(entries: readonly PluginNavEntry[]): readonly PluginNavEntry[] {
	const { featureFlags } = useFeatureSystem().services.shellDelegates;

	const requiredKeys = useMemo(() => {
		const seen = new Set<string>();
		for (const entry of entries) {
			if (entry.featureFlag !== undefined) seen.add(entry.featureFlag);
		}
		// Sorted so the signature is stable across renders regardless of
		// which order entries declared the same key.
		return [...seen].sort();
	}, [entries]);

	const getSnapshot = useCallback(() => {
		if (requiredKeys.length === 0) return "";
		const flags = featureFlags.peek();
		return requiredKeys.map((key) => `${key}=${flags[key] ? "1" : "0"}`).join("|");
	}, [featureFlags, requiredKeys]);

	const signature = useSyncExternalStore(featureFlags.subscribe, getSnapshot);

	return useMemo(() => {
		// `signature` is included in the dep list so that a flag flip
		// re-runs the filter even though `featureFlags` itself is stable.
		void signature;
		return filterVisiblePluginNav(entries, featureFlags.peek());
	}, [entries, featureFlags, signature]);
}
