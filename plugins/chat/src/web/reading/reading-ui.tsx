import {
	use,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type FC,
	type ReactNode,
} from "react";

import { useContextKey } from "@kilo-desktop/kernel/web";
import type { TakeoverProps } from "@kilo-desktop/plugin-shell/contracts";
import { FocusRail, type FocusRailTarget } from "@kilo-desktop/ui/components/reading/focus-rail";
import {
	FocusReader,
	type FocusReaderProps,
} from "@kilo-desktop/ui/components/reading/focus-reader";
import { ReadingControl } from "@kilo-desktop/ui/components/reading/reading-control";
import { useDimmingPreview } from "@kilo-desktop/ui/lib/reading/use-dimming-preview";
import { rememberExcerpt } from "@kilo-desktop/ui/lib/reading/excerpts";
import {
	readingSurfaceTheme,
	readingThemeStyle,
	resolveReadingTheme,
} from "@kilo-desktop/ui/lib/reading/reading-theme";
import { readingTypography } from "@kilo-desktop/ui/lib/reading/typography";

import { TurnWorkFoldContext } from "../tools/turn-work-fold-context";
import { chatBlockIndex, chatTargetOf, replyBlocks, type ChatFocusTarget } from "./chat-focus";
import {
	useChatReading,
	useFocusSession,
	useReadingPreferences,
	type ChatReading,
} from "./chat-reading";
import { useShortcutLabel } from "./use-shortcut-label";

const TOGGLE_FOCUS = "kilo.chat/toggle-focus";
export const FOCUS_FOOTNOTE = "Works in the chat, plans and Markdown files. Esc turns it off.";

/** CSS variables that set reading text at the reading size and spacing, from a base size. */
export function useReadingSurfaceStyle(base: "chat" | "ui"): CSSProperties {
	const reading = useChatReading()?.reading;
	const { settings, textSizes } = useReadingPreferences(reading);
	return useMemo(
		() => readingTypography("chat", settings, textSizes[base]).cssVars as CSSProperties,
		[base, settings, textSizes],
	);
}

/**
 * The reading theme over a pane's reading area outside Focus (the chat, a
 * plan): its tokens, scheme, background and text colour, spread on the area's
 * root; nothing while the reading theme is the app's own.
 */
export function useReadingThemeScope(): {
	style?: CSSProperties;
	"data-theme"?: "light" | "dark";
} {
	const reading = useChatReading()?.reading;
	const { settings, appTheme } = useReadingPreferences(reading);
	const { themeId, mode } = appTheme;
	return useMemo(() => {
		const scope = reading ? readingSurfaceTheme(settings, { themeId, mode }) : null;
		return scope ? { style: scope.style, ...scope.attributes } : {};
	}, [reading, settings, themeId, mode]);
}

/**
 * A reply's answer text as a reading surface: set at the reading size and
 * spacing, read by Focus and the rail. Narration folded into the turn's work
 * is left as it is.
 */
export const ReplyTextSurface: FC<{ children: ReactNode }> = ({ children }) => {
	const inFold = use(TurnWorkFoldContext);
	const style = useReadingSurfaceStyle("chat");
	if (inFold) return children;
	return (
		<div data-reading-surface="reply" style={style}>
			{children}
		</div>
	);
};

/** The Aa control for a pane (a transcript or a plan), entering Focus from its switch. */
export const PaneReadingControl: FC<{
	surface: "chat" | "plan";
	base: "chat" | "ui";
	enterFocus: () => void;
	className?: string;
}> = ({ surface, base, enterFocus, className }) => {
	const context = useChatReading();
	const reading = context?.reading;
	const preferences = useReadingPreferences(reading);
	const secondary = useContextKey("kernel/secondaryWindow");
	const shortcut = useShortcutLabel(TOGGLE_FOCUS);
	if (!reading) return null;
	return (
		<ReadingControl
			settings={preferences.settings}
			onChange={(patch, setting) => preferences.update(patch, setting, surface)}
			onReset={() => preferences.reset(surface)}
			appTheme={preferences.appTheme}
			baseSize={preferences.textSizes[base]}
			inFocus={false}
			focusOn={false}
			onFocusChange={(on) => {
				if (on) enterFocus();
			}}
			focusAvailable={!secondary}
			{...(shortcut ? { focusShortcut: shortcut } : {})}
			footnote={FOCUS_FOOTNOTE}
			onOpenChange={(open) => {
				if (open) reading.track("reading-control-opened", { surface });
			}}
			qaId={`chat-reading-${surface}`}
			{...(preferences.presets ? { presets: preferences.presets } : {})}
			{...(className ? { className } : {})}
		/>
	);
};

/** "Focus from here" over a pane's reading text; hidden in pop-out windows (no take-over there). */
export const PaneFocusRail: FC<{
	host: HTMLElement | null;
	onFocusFrom: (target: FocusRailTarget) => void;
	placement?: "inside" | "outside";
}> = ({ host, onFocusFrom, placement = "inside" }) => {
	const secondary = useContextKey("kernel/secondaryWindow");
	const shortcut = useShortcutLabel(TOGGLE_FOCUS);
	if (secondary || !useChatReading()) return null;
	return (
		<FocusRail
			host={host}
			onFocusFrom={onFocusFrom}
			placement={placement}
			{...(shortcut ? { shortcut } : {})}
			qaId="chat-focus-rail"
		/>
	);
};

/** The reply target a rail click means: the hovered block within its reply. */
export function replyTargetFromRail(target: FocusRailTarget): ChatFocusTarget | null {
	const first = target.block.elements[0];
	const message = first?.closest<HTMLElement>("[data-message-id]");
	const messageId = message?.dataset.messageId;
	if (!message || !messageId) return null;
	const block = replyBlocks(message).findIndex((candidate) => candidate.elements[0] === first);
	return { kind: "reply", messageId, block: Math.max(0, block) };
}

/**
 * The `kilo.chat/focus` take-over: the Focus reader in the reading theme,
 * holding a container the source pane portals its content into. It holds
 * the open session while mounted and closes itself whenever there is none,
 * so the window is never left covered by an empty take-over.
 */
export function createFocusTakeover(reading: ChatReading): FC<TakeoverProps> {
	return function ChatFocusTakeover({ close }) {
		const session = useFocusSession(reading);
		const preferences = useReadingPreferences(reading);
		const shortcut = useShortcutLabel(TOGGLE_FOCUS);
		const [container, setContainer] = useState<HTMLDivElement | null>(null);
		const sessionId = session?.id ?? null;

		useLayoutEffect(() => {
			reading.focus.setContainer(container);
		}, [container]);
		const closeRef = useRef(close);
		closeRef.current = close;
		useEffect(() => {
			if (sessionId === null) {
				closeRef.current();
				return;
			}
			return reading.focus.hold(sessionId);
		}, [sessionId]);
		const toast = useFocusToast(reading);
		const { dimming, onDimmingInput } = useDimmingPreview(preferences.settings.focus.dimming);

		if (!session) return null;
		const resolved = resolveReadingTheme(preferences.settings, preferences.appTheme);
		const theme = readingThemeStyle(resolved.themeId, resolved.mode);
		return (
			<FocusReader
				key={session.id}
				theme={theme}
				scheme={resolved.mode}
				typography={readingTypography("focus", preferences.settings)}
				dimming={dimming}
				movesWith={preferences.settings.focus.movesWith}
				initialBlock={startBlock(session.target)}
				onExit={(request) => void reading.focus.exit(request)}
				onFocusChange={(index, block) =>
					reading.focus.focusedBlock(
						index,
						session.target.kind === "reply" && block
							? (chatTargetOf(block) ?? undefined)
							: undefined,
					)
				}
				onCopy={(text) => rememberExcerpt(text, session.target.kind)}
				onVisitEnd={(summary) => reading.visitEnded(summary)}
				control={
					<ReadingControl
						settings={preferences.settings}
						onChange={(patch, setting) => preferences.update(patch, setting, "focus")}
						onDimmingInput={onDimmingInput}
						onReset={() => preferences.reset("focus")}
						appTheme={preferences.appTheme}
						baseSize={16}
						inFocus
						focusOn
						onFocusChange={(on) => {
							if (!on) void reading.focus.exit("reading-control");
						}}
						{...(shortcut ? { focusShortcut: shortcut } : {})}
						footnote={FOCUS_FOOTNOTE}
						onOpenChange={(open) => {
							if (open) reading.track("reading-control-opened", { surface: "focus" });
						}}
						qaId="chat-reading-focus"
						{...(preferences.presets ? { presets: preferences.presets } : {})}
					/>
				}
				toast={toast ?? undefined}
			>
				<div
					ref={setContainer}
					data-qa-id="chat-focus-content"
					data-focus-target={session.target.kind}
					data-shiki-theme={theme.shiki}
				/>
			</FocusReader>
		);
	};
}

/** Where the reader starts: a reply's paragraph is found among the whole chat's blocks. */
function startBlock(target: ChatFocusTarget): FocusReaderProps["initialBlock"] {
	return target.kind === "reply" ? (blocks) => chatBlockIndex(blocks, target) : target.block;
}

/** A toast a pane shows in Focus while the take-over covers it (the Saved toast). */
function useFocusToast(reading: ChatReading): ReactNode | null {
	const [node, setNode] = useState<ReactNode | null>(null);
	useEffect(() => reading.onFocusToast(setNode), [reading]);
	return node;
}
