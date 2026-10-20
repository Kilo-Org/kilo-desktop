import { useEffect, useRef, type ReactNode } from "react";

import { useCommand, useSdk } from "@kilo-desktop/sdk-react";

import {
	TERMINAL_PROTOCOL_VERSION,
	TERMINAL_SESSION_EXITED_EVENT,
	terminalSessionExitedSchema,
	type TerminalService,
} from "../contracts/session.js";
import type { ChatRightPanelCapabilities } from "./chat-right-panel.js";
import { getTerminalPaneOwner, terminalIdentityKey } from "./terminal-pane-owners.js";

function focusedTerminalFrame(): HTMLIFrameElement | null {
	const active = document.activeElement;
	return active instanceof HTMLIFrameElement && active.dataset["qaId"] === "terminal-frame"
		? active
		: null;
}

function clearFocusedTerminal(): void {
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
 * Owns terminal-exit reconciliation for the lifetime of the renderer. The main
 * process is authoritative for PTY exit; this provider translates that event
 * into idempotent pane removal and backend cleanup without depending on an
 * embedded frame being mounted or successfully relaying a window message.
 */
export function TerminalLifecycleProvider({ children }: { readonly children: ReactNode }) {
	const sdk = useSdk<TerminalService>("terminal");
	const handled = useRef(new Set<string>());

	// One registration for every terminal pane; ⌘K stays search elsewhere.
	useCommand("terminal", {
		id: "clear",
		label: "Clear terminal",
		group: "Terminal",
		keybinding: { mac: "Mod+K" },
		when: () => focusedTerminalFrame() !== null,
		handler: clearFocusedTerminal,
	});

	useEffect(
		() =>
			sdk.events.on(TERMINAL_SESSION_EXITED_EVENT, (payload) => {
				const parsed = terminalSessionExitedSchema.safeParse(payload);
				if (!parsed.success) return;
				const owner = getTerminalPaneOwner(parsed.data);
				const panel = sdk.plugins.get<ChatRightPanelCapabilities>("kilo-ui")?.chatRightPanel;
				if (!owner || !panel?.closeTab) return;

				const key = terminalIdentityKey(parsed.data);
				if (handled.current.has(key)) return;
				handled.current.add(key);
				panel.closeTab(owner.paneSessionId, owner.terminalId);
				void sdk.client
					.close({
						sessionId: owner.terminalSessionId,
						terminalId: owner.terminalId,
						deleteHistory: true,
					})
					.catch(() => undefined);
			}),
		[sdk],
	);

	return children;
}
