import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { DEFAULT_APP_THEME_PREFERENCES, themeCss } from "./app-themes.js";

import {
	APP_THEME_STORAGE_KEY,
	chromeFor,
	criticalThemeStyle,
	resolveColorScheme,
	resolveShouldUseDarkColors,
	THEME_SOURCES,
	themeSourceSchema,
	themeStateSchema,
	themeBootstrapScript,
	themeChromeColors,
	TRANSPARENT_WINDOW_BACKGROUND,
	shellGlassDarkSurface,
	shellGlassOpacity,
	usesSystemWindowMaterial,
	windowBackgroundFor,
} from "./theme.js";

const themeCssById = {
	kilo: themeCss(DEFAULT_APP_THEME_PREFERENCES),
	anaconda: "",
};

function bootstrapScript(): string {
	return themeBootstrapScript(DEFAULT_APP_THEME_PREFERENCES.themeId, themeCssById);
}

function bootstrapContext(storage: Record<string, string> = {}, systemDark = false) {
	const styles: Array<{ id: string; textContent: string }> = [];
	return {
		styles,
		localStorage: { getItem: (key: string) => storage[key] ?? null },
		matchMedia: () => ({ matches: systemDark }),
		document: {
			documentElement: {
				dataset: {} as Record<string, string>,
				style: {
					colorScheme: "",
					setProperty() {},
				},
			},
			getElementById: (id: string) => styles.find((style) => style.id === id) ?? null,
			createElement: () => ({ id: "", textContent: "" }),
			head: { appendChild: (style: (typeof styles)[number]) => styles.push(style) },
		},
	};
}

describe("theme contracts", () => {
	it("accepts renderer theme state", () => {
		const state = { source: "dark", themeId: "anaconda" };
		expect(themeStateSchema.parse(state)).toEqual(state);
		expect(themeStateSchema.safeParse({ ...state, themeId: 42 }).success).toBe(false);
	});

	it("resolves explicit and system sources", () => {
		expect(themeSourceSchema.options).toEqual(THEME_SOURCES);
		expect(resolveShouldUseDarkColors("dark", false)).toBe(true);
		expect(resolveShouldUseDarkColors("light", true)).toBe(false);
		expect(resolveShouldUseDarkColors("system", true)).toBe(true);
		expect(resolveShouldUseDarkColors("system", false)).toBe(false);
		expect(resolveColorScheme("system", true)).toBe("dark");
		expect(resolveColorScheme("light", true)).toBe("light");
	});

	it("selects chrome paint tokens", () => {
		expect(chromeFor(false)).toEqual(themeChromeColors.light);
		expect(chromeFor(true)).toEqual(themeChromeColors.dark);
	});

	it("uses transparent window paint on platforms with system materials", () => {
		expect(usesSystemWindowMaterial("darwin")).toBe(true);
		expect(usesSystemWindowMaterial("win32")).toBe(false);
		expect(usesSystemWindowMaterial("linux")).toBe(false);
		expect(windowBackgroundFor(true, "darwin")).toBe(TRANSPARENT_WINDOW_BACKGROUND);
		expect(windowBackgroundFor(false, "win32")).toBe(themeChromeColors.light.background);
		expect(windowBackgroundFor(true, "linux")).toBe(themeChromeColors.dark.background);
	});

	it("builds critical CSS from the shared tokens", () => {
		const css = criticalThemeStyle();
		expect(css).toContain("var(--sidebar,");
		expect(css).toContain(shellGlassDarkSurface);
		expect(css).toContain(`var(--shell-glass-opacity,${shellGlassOpacity.light}%)`);
		expect(css).toContain(`var(--shell-glass-opacity,${shellGlassOpacity.dark}%)`);
		expect(css).toContain('html[data-theme="dark"]');
	});

	it("paints Kilo before renderer boot when preferences are absent", () => {
		const context = bootstrapContext({}, true);
		runInNewContext(bootstrapScript(), context);
		expect(context.styles).toHaveLength(1);
		expect(context.styles[0]?.textContent).toContain("--background:#111111;");
		expect(context.document.documentElement.dataset.theme).toBe("dark");
	});

	it.each([
		["kilo", "--background:#111111;"],
		["anaconda", ""],
	])("restores saved %s without flashing another theme", (themeId, expected) => {
		const context = bootstrapContext(
			{ [APP_THEME_STORAGE_KEY]: JSON.stringify({ themeId }) },
			true,
		);
		runInNewContext(bootstrapScript(), context);
		if (expected) expect(context.styles[0]?.textContent).toContain(expected);
		else expect(context.styles).toEqual([]);
	});

	it.each(["", "{", "null", "[]", '"kilo"', '{"themeId":"__proto__"}', '{"themeId":["anaconda"]}'])(
		"uses Kilo when stored preferences are malformed: %s",
		(preferences) => {
			const context = bootstrapContext({ [APP_THEME_STORAGE_KEY]: preferences });
			runInNewContext(bootstrapScript(), context);
			expect(context.styles[0]?.textContent).toContain("--background:#111111;");
		},
	);

	it("continues boot when localStorage is unavailable", () => {
		const context = bootstrapContext({}, true);
		context.localStorage.getItem = () => {
			throw new Error("Storage denied");
		};
		expect(() => runInNewContext(bootstrapScript(), context)).not.toThrow();
		expect(context.styles[0]?.textContent).toContain("--background:#111111;");
		expect(context.document.documentElement.dataset.theme).toBe("dark");
		expect(context.document.documentElement.style.colorScheme).toBe("dark");
	});
});
