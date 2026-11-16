import type { Contribution } from "@kilo-desktop/kernel";
import { useExtensions } from "@kilo-desktop/kernel/web";

import { SETTINGS_CATEGORY, SettingsCategory, SettingsSection } from "../../contracts";

export type SettingsSectionContribution = Contribution<typeof SettingsSection>;
export type SettingsCategoryContribution = Contribution<typeof SettingsCategory>;

export interface SettingsGroup {
	/** The category's contribution key. */
	readonly key: string;
	/** The category's id, for test ids: `general`, `ai`… */
	readonly id: string;
	readonly title: string;
	readonly sections: readonly SettingsSectionContribution[];
}

/**
 * Sections under their categories, categories in their priority order and
 * sections in theirs. A section naming a category that isn't installed goes
 * under General; categories with no sections are left out.
 */
export function groupSettingsSections(
	categories: readonly SettingsCategoryContribution[],
	sections: readonly SettingsSectionContribution[],
): SettingsGroup[] {
	const known = new Set<string>(categories.map((category) => category.key));
	const fallback = known.has(SETTINGS_CATEGORY.general)
		? SETTINGS_CATEGORY.general
		: categories[0]?.key;
	const byCategory = new Map<string, SettingsSectionContribution[]>();
	for (const section of sections) {
		const key = known.has(section.metadata.category) ? section.metadata.category : fallback;
		if (key === undefined) continue;
		byCategory.set(key, [...(byCategory.get(key) ?? []), section]);
	}
	return categories.flatMap((category) => {
		const grouped = byCategory.get(category.key);
		return grouped
			? [{ key: category.key, id: category.id, title: category.metadata.title, sections: grouped }]
			: [];
	});
}

/** The visible sections, grouped for the sidebar. */
export function useSettingsGroups(
	sections: readonly SettingsSectionContribution[],
): SettingsGroup[] {
	return groupSettingsSections(useExtensions(SettingsCategory), sections);
}

export const LAST_SETTINGS_SECTION_STORAGE_KEY = "shell:settings-last-section";

/** Visible settings sections (their `when` holds), in priority order. */
export function useSettingsSections(): readonly SettingsSectionContribution[] {
	return useExtensions(SettingsSection);
}

/** The section `/settings` lands on: the last one visited if it still exists, else the first. */
export function resolveLandingSection(
	sections: readonly SettingsSectionContribution[],
	lastSectionId: string | null,
): SettingsSectionContribution | undefined {
	return sections.find((section) => section.id === lastSectionId) ?? sections[0];
}

export function readLastSettingsSection(): string | null {
	try {
		return localStorage.getItem(LAST_SETTINGS_SECTION_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function writeLastSettingsSection(sectionId: string): void {
	try {
		localStorage.setItem(LAST_SETTINGS_SECTION_STORAGE_KEY, sectionId);
	} catch {
		// Ignore quota / private-mode failures; landing falls back to the first section.
	}
}
