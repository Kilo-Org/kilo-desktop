import type { Theme } from "@pierre/highlights";
import type { CodeHighlighterPlugin } from "@pierre/words/react";
import { useEffect, useState } from "react";

type ThemeModule = { readonly default: Theme };

/** The Shiki theme names the app themes use, as `@pierre/highlights` themes. */
const THEMES: Readonly<Record<string, () => Promise<ThemeModule>>> = {
	"pierre-light": () => import("@pierre/highlights/themes/pierre-light"),
	"pierre-dark": () => import("@pierre/highlights/themes/pierre-dark"),
	"github-light": () => import("@pierre/highlights/themes/github-light"),
	"github-dark": () => import("@pierre/highlights/themes/github-dark"),
	"catppuccin-latte": () => import("@pierre/highlights/themes/catppuccin-latte"),
	"catppuccin-mocha": () => import("@pierre/highlights/themes/catppuccin-mocha"),
	dracula: () => import("@pierre/highlights/themes/dracula"),
	"gruvbox-light-medium": () => import("@pierre/highlights/themes/gruvbox-light-medium"),
	"gruvbox-dark-medium": () => import("@pierre/highlights/themes/gruvbox-dark-medium"),
	"everforest-light": () => import("@pierre/highlights/themes/everforest-light"),
	"everforest-dark": () => import("@pierre/highlights/themes/everforest-dark"),
	nord: () => import("@pierre/highlights/themes/nord"),
};

const plugins = new Map<string, CodeHighlighterPlugin>();
const loads = new Map<string, Promise<CodeHighlighterPlugin | undefined>>();

function loadPlugin(themeName: string): Promise<CodeHighlighterPlugin | undefined> {
	const existing = loads.get(themeName);
	if (existing) return existing;
	const loadTheme = THEMES[themeName] ?? THEMES["pierre-light"];
	const load = Promise.all([import("@pierre/words/highlights"), loadTheme?.()])
		.then(([{ createHighlightsPlugin }, theme]) => {
			if (!theme) return undefined;
			const plugin = createHighlightsPlugin({ theme: theme.default });
			plugins.set(themeName, plugin);
			return plugin;
		})
		.catch(() => {
			// Not remembered: a chunk that failed to load may load next time.
			loads.delete(themeName);
			return undefined;
		});
	loads.set(themeName, load);
	return load;
}

/**
 * A `@pierre/words` code highlighter in the Shiki theme `themeName`, shared by
 * every renderer in the window. The highlighter, its grammars and the theme
 * load lazily, so markdown without code pays nothing; until they arrive
 * (or with no theme) code renders plain.
 */
export function useMarkdownHighlighter(themeName: string | undefined) {
	const [loaded, setLoaded] = useState<{ themeName: string; plugin: CodeHighlighterPlugin }>();
	const plugin = !themeName
		? undefined
		: (plugins.get(themeName) ?? (loaded?.themeName === themeName ? loaded.plugin : undefined));

	useEffect(() => {
		if (!themeName || plugin) return;
		let cancelled = false;
		void loadPlugin(themeName).then((next) => {
			if (!cancelled && next) setLoaded({ themeName, plugin: next });
		});
		return () => {
			cancelled = true;
		};
	}, [themeName, plugin]);

	return plugin;
}
