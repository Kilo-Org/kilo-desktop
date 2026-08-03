import { afterEach, describe, expect, it, vi } from "vitest";

import {
	applyDocumentColorScheme,
	getColorSchemeSnapshot,
	persistThemeSource,
	readStoredThemeSource,
	subscribeColorScheme,
	THEME_STORAGE_KEY,
} from "./color-scheme";

function stubStorage(initial?: Record<string, string>) {
	const data = new Map(Object.entries(initial ?? {}));
	vi.stubGlobal("localStorage", {
		getItem: vi.fn((key: string) => data.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => {
			data.set(key, value);
		}),
	});
	return { data };
}

function stubDocumentRoot(initialTheme?: string) {
	const root = {
		dataset: (initialTheme ? { theme: initialTheme } : {}) as Record<string, string>,
		style: {} as Record<string, string>,
	};
	vi.stubGlobal("document", { documentElement: root });
	return root;
}

afterEach(() => {
	vi.unstubAllGlobals();
	stubDocumentRoot();
	applyDocumentColorScheme("light");
});

describe("readStoredThemeSource", () => {
	it("returns the stored source when valid", () => {
		stubStorage({ [THEME_STORAGE_KEY]: "dark" });
		expect(readStoredThemeSource()).toBe("dark");
	});

	it("falls back to system for missing or invalid values", () => {
		stubStorage();
		expect(readStoredThemeSource()).toBe("system");

		stubStorage({ [THEME_STORAGE_KEY]: "neon" });
		expect(readStoredThemeSource()).toBe("system");
	});

	it("falls back to system when storage throws", () => {
		vi.stubGlobal("localStorage", {
			getItem: vi.fn(() => {
				throw new Error("denied");
			}),
		});
		expect(readStoredThemeSource()).toBe("system");
	});
});

describe("persistThemeSource", () => {
	it("writes the source and swallows storage failures", () => {
		const { data } = stubStorage();
		persistThemeSource("light");
		expect(data.get(THEME_STORAGE_KEY)).toBe("light");

		vi.stubGlobal("localStorage", {
			setItem: vi.fn(() => {
				throw new Error("quota");
			}),
		});
		expect(() => persistThemeSource("dark")).not.toThrow();
	});
});

describe("applyDocumentColorScheme", () => {
	it("applies dark markers and notifies subscribers", () => {
		const root = stubDocumentRoot();
		const listener = vi.fn();
		const unsubscribe = subscribeColorScheme(listener);

		applyDocumentColorScheme("dark");
		expect(root.dataset.theme).toBe("dark");
		expect(root.style.colorScheme).toBe("dark");
		expect(getColorSchemeSnapshot()).toBe("dark");
		expect(listener).toHaveBeenCalledOnce();

		applyDocumentColorScheme("dark");
		expect(listener).toHaveBeenCalledOnce();

		unsubscribe();
		applyDocumentColorScheme("light");
		expect(root.dataset.theme).toBeUndefined();
		expect(getColorSchemeSnapshot()).toBe("light");
		expect(listener).toHaveBeenCalledOnce();
	});
});
