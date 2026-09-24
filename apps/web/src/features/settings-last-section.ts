import type { PluginSettingsSection } from "./plugin-settings";

export const LAST_SETTINGS_SECTION_STORAGE_KEY = "shell:settings-last-section";

/**
 * The section `/settings` lands on: the last one visited while it is still in
 * the nav (plugins and flags can remove sections), otherwise the first.
 */
export function resolveSettingsLandingSection(
	visible: readonly PluginSettingsSection[],
	lastSectionId: string | null,
): PluginSettingsSection | undefined {
	return visible.find((section) => section.id === lastSectionId) ?? visible[0];
}

export function readLastSettingsSection(
	storage: Pick<Storage, "getItem"> | null = getLocalStorage(),
): string | null {
	try {
		return storage?.getItem(LAST_SETTINGS_SECTION_STORAGE_KEY) ?? null;
	} catch {
		return null;
	}
}

export function writeLastSettingsSection(
	sectionId: string,
	storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
	try {
		storage?.setItem(LAST_SETTINGS_SECTION_STORAGE_KEY, sectionId);
	} catch {
		// Ignore quota / private-mode failures; landing falls back to the first section.
	}
}

function getLocalStorage(): Storage | null {
	try {
		return globalThis.localStorage;
	} catch {
		return null;
	}
}
