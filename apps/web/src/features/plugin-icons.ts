import { PuzzleIcon, ServerIcon } from "lucide-react";

import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Static icon map for bundled-plugin nav entries that declare a kebab-case
 * lucide icon name without exporting a component from their web entry module.
 *
 * Resolution order (issue #54):
 * 1. Plugin web entry exports a component matching `nav[].icon` → use it
 * 2. The name matches a key here → use that icon
 * 3. Neither → `PuzzleIcon` fallback
 *
 * Deliberately a small static map instead of `lucide-react/dynamic`: the
 * DynamicIcon route ships the full ~2,000-entry icon import map in the main
 * bundle, emits ~2,000 lazy chunks, and flashes icons in after mount — all
 * for icons that are known at build time because bundled plugins are static
 * workspace deps (Decision #10/#13).
 */
const PLUGIN_NAV_ICONS: Readonly<Record<string, LucideIcon>> = {
	server: ServerIcon,
};

/** Fallback for missing/unregistered icon names — a generic plugin icon. */
export const FALLBACK_PLUGIN_NAV_ICON: LucideIcon = PuzzleIcon;

/**
 * Resolve the icon component for a plugin nav entry.
 *
 * Resolution order (per issue #54):
 * 1. If `iconComponent` is provided (resolved from plugin web entry export) → use it
 * 2. If `iconName` matches a key in the static lucide map → use that icon
 * 3. Otherwise → fallback `PuzzleIcon`
 */
export function resolvePluginNavIcon(
	iconName: string | undefined,
	iconComponent?: ComponentType | undefined,
): ComponentType {
	if (iconComponent !== undefined) return iconComponent;
	if (iconName === undefined) return FALLBACK_PLUGIN_NAV_ICON;
	return PLUGIN_NAV_ICONS[iconName] ?? FALLBACK_PLUGIN_NAV_ICON;
}
