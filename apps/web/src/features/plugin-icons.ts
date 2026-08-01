import { ListTodoIcon, PuzzleIcon } from "lucide-react";

import type { LucideIcon } from "lucide-react";

/**
 * Icons for bundled-plugin nav entries, keyed by the kebab-case lucide icon
 * name a manifest route declares (`routes[].icon`).
 *
 * Deliberately a small static map instead of `lucide-react/dynamic`: the
 * DynamicIcon route ships the full ~2,000-entry icon import map in the main
 * bundle, emits ~2,000 lazy chunks, and flashes icons in after mount — all
 * for icons that are known at build time because bundled plugins are static
 * workspace deps (Decision #10/#13). Registering a bundled plugin already
 * touches this app (bundled-plugins.ts); adding its icon here is part of the
 * same registration. Revisit dynamic loading only when runtime-installed
 * plugins land.
 */
const PLUGIN_NAV_ICONS: Readonly<Record<string, LucideIcon>> = {
	"list-todo": ListTodoIcon,
};

/** Fallback for missing/unregistered icon names — a generic plugin icon. */
export const FALLBACK_PLUGIN_NAV_ICON: LucideIcon = PuzzleIcon;

export function resolvePluginNavIcon(name: string | undefined): LucideIcon {
	if (name === undefined) return FALLBACK_PLUGIN_NAV_ICON;
	return PLUGIN_NAV_ICONS[name] ?? FALLBACK_PLUGIN_NAV_ICON;
}
