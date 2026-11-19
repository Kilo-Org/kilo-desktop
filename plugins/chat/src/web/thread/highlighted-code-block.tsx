import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import type { DiffsHighlighter, DiffsStreamTokenizer, ThemedToken } from "@pierre/diffs";
import { Fragment, useEffect, useState, type ReactNode } from "react";

import { useDiffTheme } from "../tools/diff-theme";
import { tokenStyle } from "./token-style";
import { useLoadedHighlighter } from "./use-loaded-highlighter";

/** Past this a block stays plain: every token becomes a DOM node. */
const MAX_HIGHLIGHT_LENGTH = 50_000;
const TOKENIZE_MAX_LINE_LENGTH = 1_000;

function tokenNode(token: ThemedToken, foreground: string): ReactNode {
	const style = tokenStyle(token, foreground);
	// Token offsets are absolute in the stream, so they key every line alike.
	if (!style) return <Fragment key={token.offset}>{token.content}</Fragment>;
	return (
		<span key={token.offset} style={style}>
			{token.content}
		</span>
	);
}

/**
 * One block's incremental highlighting. The chat reveals text frame by frame,
 * so `code` grows on nearly every commit; a stream tokenizer (`stable` tokens
 * for closed lines, `unstable` for the provisional last one) keeps each commit
 * proportional to the new text instead of re-tokenizing the whole fence. The
 * session is keyed by language and theme and rebuilt when `code` no longer
 * extends what it consumed. Elements for stable tokens are kept, so React
 * reuses them across commits.
 */
interface HighlightSession {
	readonly language: string;
	readonly theme: string;
	readonly foreground: string;
	readonly tokenizer: DiffsStreamTokenizer;
	code: string;
	stable: ReactNode[];
	unstable: ReactNode[];
	rendered: ReactNode[];
}

type Sessions = { current: HighlightSession | null };

function startSession(
	sessions: Sessions,
	highlighter: DiffsHighlighter,
	language: string,
	theme: string,
): HighlightSession {
	sessions.current?.tokenizer.dispose();
	const session: HighlightSession = {
		language,
		theme,
		foreground: highlighter.getTheme(theme).fg.toLowerCase(),
		tokenizer: highlighter.createStreamTokenizer({
			lang: language,
			theme,
			tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
		}),
		code: "",
		stable: [],
		unstable: [],
		rendered: [],
	};
	sessions.current = session;
	return session;
}

/**
 * Feeds `code` to the session and returns the rendered tokens, which always
 * spell out exactly `code`. Called during render on purpose: the tokenizer
 * only ever appends, and an identical `code` returns the previous render, so a
 * repeated or discarded render cannot double-feed it.
 */
function highlight(
	sessions: Sessions,
	highlighter: DiffsHighlighter,
	language: string,
	theme: string,
	code: string,
): ReactNode {
	const current = sessions.current;
	const session =
		current &&
		current.language === language &&
		current.theme === theme &&
		code.startsWith(current.code)
			? current
			: startSession(sessions, highlighter, language, theme);
	if (code === session.code) return session.rendered;

	const result = session.tokenizer.enqueue(code.slice(session.code.length));
	if (result instanceof Promise) {
		// Every Shiki backend tokenizes synchronously; an asynchronous one could
		// only color this text after the commit, so leave it plain instead.
		void result.catch(() => undefined);
		sessions.current = null;
		session.tokenizer.dispose();
		return code;
	}

	const { stable, unstable } = result;
	for (const token of stable) session.stable.push(tokenNode(token, session.foreground));
	session.unstable = unstable.map((token) => tokenNode(token, session.foreground));
	session.code = code;
	session.rendered = [...session.stable, ...session.unstable];
	return session.rendered;
}

/** One block's highlight session across its renders, released with `dispose`. */
class BlockHighlighter {
	readonly #sessions: Sessions = { current: null };

	/** The colored tokens of `code`; see `HighlightedCode`. */
	render(
		highlighter: DiffsHighlighter | undefined,
		language: string,
		theme: string,
		code: string,
	): ReactNode {
		if (code.length > MAX_HIGHLIGHT_LENGTH) {
			// The session cannot resume past the cap; release its tokenizer and elements.
			this.dispose();
			return code;
		}
		if (!highlighter) {
			// A theme switch has no highlighter for a moment; keep the colors of the
			// text already shown instead of flashing it plain.
			const session = this.#sessions.current;
			return session?.language === language && session.code === code ? session.rendered : code;
		}
		return highlight(this.#sessions, highlighter, language, theme, code);
	}

	dispose() {
		this.#sessions.current?.tokenizer.dispose();
		this.#sessions.current = null;
	}
}

/**
 * The colored tokens of `code`, or `code` itself past the size cap, until the
 * grammar loads, or for a language Shiki lacks, so the text is always exactly
 * the fence's code.
 */
function HighlightedCode({ code, language }: { readonly code: string; readonly language: string }) {
	const { shiki: theme } = useDiffTheme();
	const highlighter = useLoadedHighlighter(language, theme, code);
	const [blockHighlighter] = useState(() => new BlockHighlighter());
	useEffect(() => () => blockHighlighter.dispose(), [blockHighlighter]);
	return blockHighlighter.render(highlighter, language, theme, code);
}

/**
 * A fenced code block colored by Shiki in the window's theme, rendered through
 * the markdown `Pre`/`Code` it is given so chat styling and component
 * decorators still apply. The highlighting state lives in a child: the
 * memoized `Pre` only re-renders when the fence's markdown node changes, so a
 * grammar or theme that loads later must update below it.
 */
export function HighlightedCodeBlock({
	components: { Pre, Code },
	language,
	code,
}: SyntaxHighlighterProps) {
	const normalizedLanguage = language.trim().toLowerCase();
	return (
		<Pre data-qa-id="chat-code-block" data-language={normalizedLanguage || undefined}>
			<Code>
				<HighlightedCode code={code} language={normalizedLanguage} />
			</Code>
		</Pre>
	);
}
