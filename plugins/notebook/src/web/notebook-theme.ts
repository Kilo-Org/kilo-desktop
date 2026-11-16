type ThemeAppearance = { readonly mode: "light" | "dark" };

import {
	NOTEBOOK_THEME_MESSAGE_TYPE,
	NOTEBOOK_THEME_TOKEN_NAMES,
	type NotebookThemeMessage,
	type NotebookThemeTokenName,
} from "../contracts/notebook-theme.js";

export {
	NOTEBOOK_THEME_MESSAGE_TYPE,
	NOTEBOOK_THEME_READY_MESSAGE_TYPE,
} from "../contracts/notebook-theme.js";

export function notebookThemeTokensFrom(
	read: (customProperty: string) => string,
): NotebookThemeMessage["tokens"] {
	const tokens: Partial<Record<NotebookThemeTokenName, string>> = {};
	for (const name of NOTEBOOK_THEME_TOKEN_NAMES) {
		const value = read(`--${name}`).trim();
		if (value) tokens[name] = value;
	}
	return tokens;
}

/**
 * Resolve host CSS variables to used colors so the iframe does not need the
 * parent's primitive palette (`--color-mist-*`, `color-mix`, `var()`).
 */
export function notebookThemeTokensFromDocument(
	root: HTMLElement = document.documentElement,
	backgroundProperty = "--background",
): NotebookThemeMessage["tokens"] {
	const probe = root.ownerDocument.createElement("span");
	probe.style.cssText = "position:fixed;left:-9999px;pointer-events:none";
	root.append(probe);
	try {
		const tokens = notebookThemeTokensFrom((property) => {
			if (!getComputedStyle(root).getPropertyValue(property).trim()) return "";
			probe.style.color = `var(${property})`;
			return getComputedStyle(probe).color;
		});
		if (getComputedStyle(root).getPropertyValue(backgroundProperty).trim()) {
			probe.style.color = `var(${backgroundProperty})`;
			return { ...tokens, background: getComputedStyle(probe).color };
		}
		return tokens;
	} finally {
		probe.remove();
	}
}

export function notebookThemeMessage(
	appearance: Pick<ThemeAppearance, "mode">,
	tokens: NotebookThemeMessage["tokens"],
): NotebookThemeMessage {
	return {
		type: NOTEBOOK_THEME_MESSAGE_TYPE,
		mode: appearance.mode,
		tokens,
	};
}
