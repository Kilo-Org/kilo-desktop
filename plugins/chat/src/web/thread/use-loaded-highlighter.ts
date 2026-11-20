import { getHighlighterIfLoaded, getSharedHighlighter, type DiffsHighlighter } from "@pierre/diffs";
import { useEffect, useState } from "react";

const PLAIN_LANGUAGES = new Set(["", "text", "txt", "plain", "plaintext"]);

/**
 * The shared highlighter if it has `theme` and `language` now. `revision`
 * (the block's code) is unused here, but as an argument it makes React
 * Compiler, which caches this read on its arguments, read again as the block
 * changes, so a block whose own load missed picks up a load another block made.
 */
function sharedHighlighterIfLoaded(
	theme: string,
	language: string,
	_revision: string,
): DiffsHighlighter | undefined {
	return getHighlighterIfLoaded({ theme, lang: language });
}

/**
 * The window's shared Shiki highlighter (the one file previews use) once it
 * has `language` and `theme` loaded; until then, or for a language Shiki
 * lacks, nothing. Loading is lazy so a reply without code pays nothing. A
 * failed load is not remembered: it may be a missing grammar, but it may also
 * be a theme or chunk failure that a later block can recover from, so the
 * shared highlighter is checked again whenever `code` changes.
 */
export function useLoadedHighlighter(
	language: string,
	theme: string,
	code: string,
): DiffsHighlighter | undefined {
	const highlightable = !PLAIN_LANGUAGES.has(language);
	const key = `${theme}\n${language}`;
	// What this block's own load found, so the render after it sees the
	// highlighter even though `code` hasn't changed. A miss is not kept.
	const [load, setLoad] = useState<{
		readonly key: string;
		readonly highlighter: DiffsHighlighter;
	} | null>(null);
	const loaded = !highlightable
		? undefined
		: load?.key === key
			? load.highlighter
			: sharedHighlighterIfLoaded(theme, language, code);

	useEffect(() => {
		if (!highlightable || loaded) return;
		let cancelled = false;
		getSharedHighlighter({ themes: [theme], langs: [language], preferredHighlighter: "shiki-js" })
			.catch(() => undefined)
			.finally(() => {
				const highlighter = getHighlighterIfLoaded({ theme, lang: language });
				if (!cancelled && highlighter) setLoad({ key, highlighter });
			});
		return () => {
			cancelled = true;
		};
	}, [highlightable, loaded, key, language, theme]);

	return loaded;
}
