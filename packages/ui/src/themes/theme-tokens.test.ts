import { describe, expect, it } from "vitest";

import {
	APP_THEME_STORAGE_KEY,
	chromeFor,
	criticalThemeStyle,
	DEFAULT_TEXT_SIZES,
	normalizeTextSizes,
	resolveColorScheme,
	SIDEBAR_VIBRANCY_STORAGE_KEY,
	TEXT_SIZE_RANGE,
	TEXT_SIZE_STORAGE_KEY,
	themeBootstrapScript,
	themeChromeColors,
	THEME_STORAGE_KEY,
	TRANSPARENT_WINDOW_BACKGROUND,
	windowBackgroundFor,
} from "./theme-tokens";

describe("normalizeTextSizes", () => {
	it("falls back to the defaults for anything but an object", () => {
		expect(normalizeTextSizes(null)).toEqual(DEFAULT_TEXT_SIZES);
		expect(normalizeTextSizes([16, 16])).toEqual(DEFAULT_TEXT_SIZES);
		expect(normalizeTextSizes("16")).toEqual(DEFAULT_TEXT_SIZES);
	});

	it("rounds and clamps each size, defaulting what is missing or not a number", () => {
		expect(normalizeTextSizes({ ui: 15.6, chat: Number.NaN })).toEqual({
			ui: 16,
			chat: DEFAULT_TEXT_SIZES.chat,
		});
		expect(normalizeTextSizes({ ui: 2, chat: 99 })).toEqual({
			ui: TEXT_SIZE_RANGE.min,
			chat: TEXT_SIZE_RANGE.max,
		});
	});
});

describe("color scheme and window chrome", () => {
	it("follows the system only when the source is system", () => {
		expect(resolveColorScheme("system", true)).toBe("dark");
		expect(resolveColorScheme("system", false)).toBe("light");
		expect(resolveColorScheme("dark", false)).toBe("dark");
		expect(resolveColorScheme("light", true)).toBe("light");
	});

	it("paints opaque chrome except where the OS draws a window material", () => {
		expect(chromeFor(true)).toBe(themeChromeColors.dark);
		expect(windowBackgroundFor(false, "linux")).toBe(themeChromeColors.light.background);
		expect(windowBackgroundFor(true, "win32")).toBe(themeChromeColors.dark.background);
		expect(windowBackgroundFor(true, "darwin")).toBe(TRANSPARENT_WINDOW_BACKGROUND);
	});

	it("tints only the html element before first paint", () => {
		const css = criticalThemeStyle();
		expect(css).toContain('html[data-theme="dark"]{background:');
		expect(css).toContain("body{background:transparent}");
	});
});

describe("themeBootstrapScript", () => {
	function runBootstrap(
		stored: Record<string, string>,
		{ systemDark = false }: { systemDark?: boolean } = {},
	) {
		const properties = new Map<string, string>();
		const head: { id: string; textContent: string }[] = [];
		const root = {
			dataset: {} as Record<string, string>,
			style: {
				colorScheme: "",
				setProperty: (name: string, value: string) => properties.set(name, value),
			},
		};
		const document = {
			documentElement: root,
			getElementById: (id: string) => head.find((element) => element.id === id) ?? null,
			createElement: () => ({ id: "", textContent: "" }),
			head: { appendChild: (element: { id: string; textContent: string }) => head.push(element) },
		};
		const localStorage = { getItem: (key: string) => stored[key] ?? null };
		const matchMedia = () => ({ matches: systemDark });
		const script = themeBootstrapScript(
			"anaconda",
			{ anaconda: ".anaconda{}", ocean: ".ocean{}" },
			{ green: ".green{}" },
		);
		new Function("document", "localStorage", "matchMedia", script)(
			document,
			localStorage,
			matchMedia,
		);
		return { root, properties, appTheme: head.find((element) => element.id === "app-theme") };
	}

	it("applies the default dark source and theme when nothing is stored", () => {
		const { root, appTheme } = runBootstrap({});

		expect(root.dataset.theme).toBe("dark");
		expect(root.style.colorScheme).toBe("dark");
		expect(appTheme?.textContent).toBe(".anaconda{}");
	});

	it("restores the stored source, text sizes, vibrancy and theme selection", () => {
		const { root, properties, appTheme } = runBootstrap(
			{
				[THEME_STORAGE_KEY]: "system",
				[SIDEBAR_VIBRANCY_STORAGE_KEY]: "false",
				[TEXT_SIZE_STORAGE_KEY]: JSON.stringify({ ui: 40, chat: 15.4 }),
				[APP_THEME_STORAGE_KEY]: JSON.stringify({ themeId: "ocean", accentId: "green" }),
			},
			{ systemDark: false },
		);

		expect(root.dataset.theme).toBeUndefined();
		expect(root.style.colorScheme).toBe("light");
		expect(properties.get("--shell-glass-opacity")).toBe("100%");
		expect(properties.get("--app-ui-text-size")).toBe(`${TEXT_SIZE_RANGE.max}px`);
		expect(properties.get("--app-chat-text-size")).toBe("15px");
		expect(appTheme?.textContent).toBe(".ocean{}.green{}");
	});

	it("ignores unknown or corrupt stored selections", () => {
		const { root, properties, appTheme } = runBootstrap({
			[THEME_STORAGE_KEY]: "sepia",
			[TEXT_SIZE_STORAGE_KEY]: "{",
			[APP_THEME_STORAGE_KEY]: JSON.stringify({ themeId: "missing", accentId: "missing" }),
		});

		expect(root.dataset.theme).toBe("dark");
		expect(properties.size).toBe(0);
		expect(appTheme?.textContent).toBe(".anaconda{}");
	});
});
