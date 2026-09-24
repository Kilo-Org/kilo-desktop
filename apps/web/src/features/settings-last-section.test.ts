import { describe, expect, it } from "vitest";

import type { PluginSettingsSection } from "./plugin-settings";
import {
	LAST_SETTINGS_SECTION_STORAGE_KEY,
	readLastSettingsSection,
	resolveSettingsLandingSection,
	writeLastSettingsSection,
} from "./settings-last-section";

function section(id: string): PluginSettingsSection {
	return {
		pluginId: "test",
		id,
		title: id,
		component: () => null,
		category: "Personal",
		icon: undefined,
		iconComponent: undefined,
		priority: 0,
		featureFlag: undefined,
		browserSafe: true,
	};
}

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
		values,
	};
}

const throwingStorage = {
	getItem: () => {
		throw new Error("denied");
	},
	setItem: () => {
		throw new Error("quota");
	},
};

describe("resolveSettingsLandingSection", () => {
	const visible = [section("account"), section("appearance"), section("about")];

	it("returns the last visited section when it is still visible", () => {
		expect(resolveSettingsLandingSection(visible, "appearance")?.id).toBe("appearance");
	});

	it("falls back to the first visible section when nothing was remembered", () => {
		expect(resolveSettingsLandingSection(visible, null)?.id).toBe("account");
	});

	it("falls back to the first visible section when the remembered one is no longer visible", () => {
		expect(resolveSettingsLandingSection(visible, "removed-plugin")?.id).toBe("account");
	});

	it("returns undefined when no sections are visible", () => {
		expect(resolveSettingsLandingSection([], "appearance")).toBeUndefined();
	});
});

describe("last settings section storage", () => {
	it("round-trips the last visited section id", () => {
		const storage = memoryStorage();
		writeLastSettingsSection("appearance", storage);

		expect(storage.values.get(LAST_SETTINGS_SECTION_STORAGE_KEY)).toBe("appearance");
		expect(readLastSettingsSection(storage)).toBe("appearance");
	});

	it("reads null when nothing is stored", () => {
		expect(readLastSettingsSection(memoryStorage())).toBeNull();
	});

	it("tolerates unavailable or failing storage", () => {
		expect(readLastSettingsSection(null)).toBeNull();
		expect(readLastSettingsSection(throwingStorage)).toBeNull();
		expect(() => writeLastSettingsSection("appearance", null)).not.toThrow();
		expect(() => writeLastSettingsSection("appearance", throwingStorage)).not.toThrow();
	});
});
