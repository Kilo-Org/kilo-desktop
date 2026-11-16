import { tokenStyle as tokenCss, type ThemedToken } from "@pierre/diffs";
import type { CSSProperties } from "react";

/** Distinct styles are few (a theme's scopes), so parsing each CSS string once is enough. */
const parsedStyles = new Map<string, CSSProperties | undefined>();

function reactPropertyName(name: string): string {
	return name.startsWith("--")
		? name
		: name.replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());
}

/**
 * A token's style as a React `style` object, built from the CSS `@pierre/diffs`
 * gives file previews so chat and previews paint a token alike. The one
 * difference: the theme's plain-text color is left to inherit, so plain code
 * matches the reply's text. `foreground` is that color, lowercased.
 */
export function tokenStyle(token: ThemedToken, foreground: string): CSSProperties | undefined {
	const css = tokenCss(token);
	const key = `${foreground}\n${css}`;
	if (parsedStyles.has(key)) return parsedStyles.get(key);

	const style: Record<string, string> = {};
	for (const declaration of css.split(";")) {
		const separator = declaration.indexOf(":");
		if (separator <= 0) continue;
		const name = declaration.slice(0, separator).trim();
		const value = declaration.slice(separator + 1).trim();
		if (name === "color" && value.toLowerCase() === foreground) continue;
		style[reactPropertyName(name)] = value;
	}
	const parsed = Object.keys(style).length > 0 ? (style as CSSProperties) : undefined;
	parsedStyles.set(key, parsed);
	return parsed;
}
