import type { PluginSdk } from "@kilo-desktop/kernel";

import { TERMINAL_PROTOCOL_VERSION } from "../contracts/session";

const TERMINAL_FRAME_QA_ID = "terminal-frame";
const FOCUSED_KEY = "terminalFocused";

function focusedTerminalFrame(): HTMLIFrameElement | null {
	const active = document.activeElement;
	return active instanceof HTMLIFrameElement && active.dataset["qaId"] === TERMINAL_FRAME_QA_ID
		? active
		: null;
}

/** Clears the screen and scrollback of the terminal with keyboard focus, if any. */
export function clearFocusedTerminal(): void {
	const frame = focusedTerminalFrame();
	if (!frame?.contentWindow) return;
	// URL.origin is "null" for custom schemes like kilo-desktop://terminal.
	const { protocol, host } = new URL(frame.src);
	frame.contentWindow.postMessage(
		{ type: "terminal:clear", protocolVersion: TERMINAL_PROTOCOL_VERSION },
		`${protocol}//${host}`,
	);
}

/**
 * Keeps `terminalFocused` true while any terminal frame in this window has
 * focus. Every mounted terminal follows the same window-wide fact, so
 * several of them can't disagree. Focus moving into a frame blurs the window
 * before `activeElement` settles, hence the deferred check.
 */
export function followTerminalFocus(sdk: PluginSdk, frame: HTMLIFrameElement): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const setFocused = (focused: boolean) => {
		try {
			sdk.context.set(FOCUSED_KEY, focused);
		} catch {
			// The plugin is deactivating; its keys go with it.
		}
	};
	const update = () => {
		clearTimeout(timer);
		timer = setTimeout(() => setFocused(focusedTerminalFrame() !== null));
	};
	window.addEventListener("blur", update);
	window.addEventListener("focus", update);
	document.addEventListener("focusin", update);
	frame.addEventListener("focus", update);
	frame.addEventListener("blur", update);
	update();
	return () => {
		window.removeEventListener("blur", update);
		window.removeEventListener("focus", update);
		document.removeEventListener("focusin", update);
		frame.removeEventListener("focus", update);
		frame.removeEventListener("blur", update);
		clearTimeout(timer);
		setFocused(focusedTerminalFrame() !== null && frame !== document.activeElement);
	};
}
