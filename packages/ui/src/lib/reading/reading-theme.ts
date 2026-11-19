import type { CSSProperties } from "react";

import { APP_THEMES, getThemeVariant } from "../../themes/app-themes";
import type { ResolvedColorScheme } from "../../themes/theme-tokens";
import type { ReadingSettings } from "./settings";

/**
 * Roles globals.css derives from the palette at `:root`. A custom property's
 * `var()` resolves where it is declared, so a subtree with another palette
 * must restate them or it would inherit the app's computed values.
 */
const DERIVED_ROLES: Readonly<Record<string, string>> = {
	"--info-surface": "color-mix(in oklch, var(--info) 10%, transparent)",
	"--success-surface": "color-mix(in oklch, var(--success) 10%, transparent)",
	"--warning-surface": "color-mix(in oklch, var(--warning) 10%, transparent)",
	"--border-subtle": "color-mix(in oklch, var(--border) 60%, transparent)",
	"--state-hover": "color-mix(in oklch, var(--state-tint) 4%, transparent)",
	"--state-selected": "color-mix(in oklch, var(--state-tint) 7%, transparent)",
	"--state-selected-strong": "color-mix(in oklch, var(--state-tint) 10%, transparent)",
	"--ghost-hover": "var(--state-hover)",
	"--pane-hairline": "color-mix(in oklch, var(--foreground) 15%, transparent)",
	"--pane-surface": "var(--background)",
	"--pane-raised": "var(--card)",
	"--sidebar-accent": "var(--state-hover)",
};

export interface AppThemeSnapshot {
	readonly themeId: string;
	readonly mode: ResolvedColorScheme;
}

export interface ResolvedReadingTheme extends AppThemeSnapshot {
	/** Whether it differs from the app's theme (a reading theme or mode was chosen). */
	readonly applied: boolean;
}

/** The reading theme in effect: the chosen theme and mode, else the app's. */
export function resolveReadingTheme(
	settings: ReadingSettings,
	app: AppThemeSnapshot,
): ResolvedReadingTheme {
	const themeId = settings.themeId ?? app.themeId;
	const mode = settings.mode === "auto" ? app.mode : settings.mode;
	return { themeId, mode, applied: themeId !== app.themeId || mode !== app.mode };
}

export interface ReadingThemeStyle {
	/** Spread on the subtree's root: tokens, derived roles and `color-scheme`. */
	readonly style: CSSProperties;
	/** Spread on the root too: scopes the `dark:` variant to the subtree's scheme. */
	readonly attributes: { readonly "data-theme": ResolvedColorScheme };
	/** The theme's code highlighting. */
	readonly shiki: string;
}

/**
 * Paints a subtree (the Focus take-over, a reading surface) with one of the
 * app's themes, whatever the app's own. Popovers and menus opened inside
 * portal out of it and keep the app's theme.
 */
export function readingThemeStyle(themeId: string, mode: ResolvedColorScheme): ReadingThemeStyle {
	const variant = getThemeVariant(themeId, mode);
	const tokens = Object.fromEntries(
		Object.entries(variant.tokens).map(([key, value]) => [`--${key}`, value]),
	);
	const tint = "state-tint" in variant.tokens ? {} : { "--state-tint": "var(--foreground)" };
	return {
		style: { ...tokens, ...tint, ...DERIVED_ROLES, colorScheme: mode } as CSSProperties,
		attributes: { "data-theme": mode },
		shiki: variant.shiki,
	};
}

/**
 * The reading theme over a reading surface outside Focus (a chat, a plan, a
 * Markdown preview), painted with its own background and text colour (text
 * colour inherits computed, so it must be restated); null while the reading
 * theme is the app's own.
 */
export function readingSurfaceTheme(
	settings: ReadingSettings,
	app: AppThemeSnapshot,
): ReadingThemeStyle | null {
	const resolved = resolveReadingTheme(settings, app);
	if (!resolved.applied) return null;
	const theme = readingThemeStyle(resolved.themeId, resolved.mode);
	return {
		...theme,
		style: { ...theme.style, backgroundColor: "var(--background)", color: "var(--foreground)" },
	};
}

export interface ReadingThemeSwatch {
	readonly id: (typeof APP_THEMES)[number]["id"];
	readonly name: string;
	readonly background: string;
	readonly accent: string;
}

const isLiteral = (value: string | undefined): value is string =>
	value !== undefined && !value.startsWith("var(");

/** One swatch per Appearance theme: its background with its accent (brand colour where it has one). */
export function readingThemeSwatches(mode: ResolvedColorScheme): readonly ReadingThemeSwatch[] {
	return APP_THEMES.map((theme) => {
		const tokens = theme.variants[mode].tokens as Readonly<Record<string, string>>;
		const brand = tokens["primary-brand"];
		return {
			id: theme.id,
			name: theme.name,
			background: tokens.background!,
			accent: isLiteral(brand) ? brand : tokens.primary!,
		};
	});
}

export function readingThemeName(themeId: string): string {
	return APP_THEMES.find(({ id }) => id === themeId)?.name ?? themeId;
}
