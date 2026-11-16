/** Appearance theme sources: the `appearance-theme-<source>` card ids and `nativeTheme.themeSource` values. */
export const themeData = {
	sources: { light: "light", system: "system", dark: "dark" },
} as const;

export type ThemeSource = (typeof themeData.sources)[keyof typeof themeData.sources];
