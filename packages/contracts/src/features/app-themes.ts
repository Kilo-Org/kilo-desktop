import { themeChromeColors, type ResolvedColorScheme } from "./theme-tokens.js";
import type { ThemeAppearance, TerminalPalette } from "@anaconda-agentic-desktop/feature-sdk";

export { APP_THEME_STORAGE_KEY } from "./theme-tokens.js";

type RolePalette = {
	background: string;
	foreground: string;
	surface: string;
	popover?: string;
	sidebar: string;
	hover: string;
	muted: string;
	border: string;
	primary: string;
	primaryForeground: string;
	charts: readonly [string, string, string, string, string];
	ansi: readonly [string, string, string, string, string, string, string, string];
};

type ShikiTheme = "github-dark" | "github-light" | "pierre-dark" | "pierre-light";

const ansiRoles = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightMagenta",
	"brightCyan",
	"brightWhite",
] as const satisfies readonly (keyof TerminalPalette)[];

type TerminalRolePalette = Pick<RolePalette, "background" | "foreground" | "hover" | "ansi">;

function terminalPalette(palette: TerminalRolePalette): TerminalPalette {
	return {
		background: palette.background,
		foreground: palette.foreground,
		cursor: palette.foreground,
		cursorAccent: palette.background,
		selectionBackground: palette.hover,
		selectionForeground: palette.foreground,
		...(Object.fromEntries(
			[...palette.ansi, ...palette.ansi].map((color, index) => [ansiRoles[index], color]),
		) as { [K in (typeof ansiRoles)[number]]: string }),
	};
}

function variant(palette: RolePalette, mode: ResolvedColorScheme, shiki: ShikiTheme) {
	const status =
		mode === "light"
			? { error: "#9f1239", info: "#1e40af", update: "#166534" }
			: { error: "#ffe4e6", info: "#dbeafe", update: "#bbf7d0" };
	return {
		tokens: {
			background: palette.background,
			foreground: palette.foreground,
			card: palette.surface,
			"card-foreground": palette.foreground,
			popover: palette.popover ?? palette.surface,
			"popover-foreground": palette.foreground,
			primary: palette.primary,
			"primary-foreground": palette.primaryForeground,
			secondary: palette.hover,
			"secondary-foreground": palette.foreground,
			muted: palette.hover,
			"muted-foreground": palette.muted,
			accent: palette.hover,
			"accent-foreground": palette.foreground,
			destructive: status.error,
			"destructive-foreground": status.error,
			border: palette.border,
			input: palette.border,
			ring: palette.primary,
			"chart-1": palette.charts[0],
			"chart-2": palette.charts[1],
			"chart-3": palette.charts[2],
			"chart-4": palette.charts[3],
			"chart-5": palette.charts[4],
			sidebar: palette.sidebar,
			"sidebar-foreground": palette.foreground,
			"sidebar-primary": palette.primary,
			"sidebar-primary-foreground": palette.primaryForeground,
			"sidebar-accent": palette.hover,
			"sidebar-accent-foreground": palette.foreground,
			"sidebar-border": palette.border,
			"sidebar-ring": palette.primary,
			info: status.info,
			"info-foreground": status.info,
			"app-scrollbar-thumb": palette.border,
			"app-scrollbar-thumb-hover": palette.muted,
			update: status.update,
			"update-surface": palette.surface,
			"update-surface-hover": palette.hover,
		},
		terminal: terminalPalette(palette),
		shiki,
	};
}

/** CSS-owned preset: no token overrides, only a Ghostty-ready terminal palette. */
function cssTheme(palette: TerminalRolePalette, shiki: ShikiTheme) {
	return { tokens: null, terminal: terminalPalette(palette), shiki };
}

export type ThemeVariant = {
	tokens: ReturnType<typeof variant>["tokens"] | null;
	terminal: TerminalPalette | null;
	shiki: ShikiTheme;
};

export interface AppTheme {
	id: string;
	name: string;
	variants: Record<ResolvedColorScheme, ThemeVariant | null>;
}

export const APP_THEMES = [
	{
		id: "kilo",
		name: "Kilo",
		variants: {
			// Unofficial light companion: Kilo's design system only defines dark surfaces.
			light: variant(
				{
					background: "#fafaf7",
					foreground: "#1f1f1f",
					surface: "#ffffff",
					sidebar: "#f0f0e8",
					hover: "#e7e7d9",
					muted: "#66665a",
					border: "#d2d2c3",
					primary: "#656300",
					primaryForeground: "#ffffff",
					charts: ["#2563eb", "#16a34a", "#d28100", "#9333ea", "#009689"],
					ansi: [
						"#1f1f1f",
						"#c2415d",
						"#3f7f5b",
						"#b66a14",
						"#2563eb",
						"#9333ea",
						"#009689",
						"#f7f7ee",
					],
				},
				"light",
				"github-light",
			),
			// Based on Kilo design v0.2.0, with neutral surfaces tuned for desktop.
			dark: variant(
				{
					background: "#111111",
					foreground: "#fafafa",
					surface: "#1f1f1f",
					popover: "#2b2b2b",
					sidebar: "#161616",
					hover: "#333333",
					muted: "#a3a3a3",
					border: "#303030",
					primary: "#f7f586",
					primaryForeground: "#1f1f1f",
					charts: ["#60a5fa", "#4ade80", "#f7f586", "#c084fc", "#00d4c2"],
					ansi: [
						"#303030",
						"#ffe4e6",
						"#bbf7d0",
						"#f7f586",
						"#bfdbfe",
						"#e9d5ff",
						"#99f6e4",
						"#fafafa",
					],
				},
				"dark",
				"github-dark",
			),
		},
	},
	{
		id: "anaconda",
		name: "Anaconda",
		variants: {
			// Surfaces stay in `@anaconda/shadcn-theme` + globals.css; Ghostty needs hex.
			light: cssTheme(
				{
					background: "#ffffff",
					foreground: "#090b0c",
					hover: "#f1f3f3",
					ansi: [
						"#090b0c",
						"#e7000b",
						"#07ca4a",
						"#fe9a00",
						"#155dfc",
						"#9810fa",
						"#0092b8",
						"#f9fbfb",
					],
				},
				"pierre-light",
			),
			dark: cssTheme(
				{
					background: "#101314",
					foreground: "#f9fbfb",
					hover: "#22292b",
					ansi: [
						"#22292b",
						"#ff6467",
						"#96f778",
						"#a5f28d",
						"#50a2ff",
						"#c27aff",
						"#00d3f3",
						"#f9fbfb",
					],
				},
				"pierre-dark",
			),
		},
	},
] as const satisfies readonly AppTheme[];

export interface AppThemePreferences {
	themeId: string;
}

export const DEFAULT_APP_THEME_PREFERENCES: AppThemePreferences = { themeId: "kilo" };

export function normalizeAppThemePreferences(value: unknown): AppThemePreferences {
	const input =
		value !== null && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	return {
		themeId:
			APP_THEMES.find(({ id }) => id === input.themeId)?.id ??
			DEFAULT_APP_THEME_PREFERENCES.themeId,
	};
}

export function getThemeVariant(themeId: string, mode: ResolvedColorScheme): ThemeVariant | null {
	const theme =
		APP_THEMES.find(({ id }) => id === themeId) ??
		APP_THEMES.find(({ id }) => id === DEFAULT_APP_THEME_PREFERENCES.themeId)!;
	return theme.variants[mode];
}

export function themeCss(preferences: AppThemePreferences): string {
	const { themeId } = normalizeAppThemePreferences(preferences);
	return (["light", "dark"] as const)
		.map((mode) => {
			const tokens = getThemeVariant(themeId, mode)?.tokens;
			let declarations = Object.entries(tokens ?? {})
				.map(([key, value]) => `--${key}:${value};`)
				.join("");
			// Limit wallpaper tint in Kilo dark; the vibrancy-off inline style still wins.
			if (themeId === "kilo" && mode === "dark") {
				declarations += "--shell-glass-opacity:96%;--chat-ambient-glow:#f7f586;";
			}
			if (!declarations) return "";
			return `${mode === "light" ? "html:root" : 'html:root[data-theme="dark"]'}{${declarations}}`;
		})
		.join("");
}

export function getThemeAppearance(
	preferences: AppThemePreferences,
	mode: ResolvedColorScheme,
): ThemeAppearance {
	const { themeId } = normalizeAppThemePreferences(preferences);
	const variant = getThemeVariant(themeId, mode);
	return {
		mode,
		themeId,
		terminal: variant?.terminal ?? null,
		shiki: variant?.shiki ?? (mode === "light" ? "pierre-light" : "pierre-dark"),
	};
}

export function getThemeChrome(themeId: string): {
	light: { background: string; foreground: string };
	dark: { background: string; foreground: string };
} {
	const light = getThemeVariant(themeId, "light")?.tokens ?? themeChromeColors.light;
	const dark = getThemeVariant(themeId, "dark")?.tokens ?? themeChromeColors.dark;
	return {
		light: { background: light.background, foreground: light.foreground },
		dark: { background: dark.background, foreground: dark.foreground },
	};
}
