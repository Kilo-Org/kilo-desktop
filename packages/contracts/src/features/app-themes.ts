import { themeChromeColors, type ResolvedColorScheme } from "./theme-tokens.js";

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
};

function variant(palette: RolePalette, mode: ResolvedColorScheme) {
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
	};
}

export type ThemeVariant = ReturnType<typeof variant>;

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
				},
				"light",
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
				},
				"dark",
			),
		},
	},
	{ id: "anaconda", name: "Anaconda", variants: { light: null, dark: null } },
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
			if (themeId === "kilo" && mode === "dark") declarations += "--shell-glass-opacity:96%;";
			if (!declarations) return "";
			return `${mode === "light" ? "html:root" : 'html:root[data-theme="dark"]'}{${declarations}}`;
		})
		.join("");
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
