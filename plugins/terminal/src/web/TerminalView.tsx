import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlertIcon, SquareTerminalIcon } from "lucide-react";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState, useSdk } from "@kilo-desktop/kernel/web";
import { Theme } from "@kilo-desktop/plugin-shell/contracts";
import type { PaneProps } from "@kilo-desktop/plugin-work-sessions/contracts";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import type { TerminalPalette } from "@kilo-desktop/ui/themes/appearance-types";

import { TERMINAL_PORT, TERMINAL_SESSION_METADATA_KEY, Terminals } from "../contracts";
import { TERMINAL_PROTOCOL_VERSION, type TerminalIdentity } from "../contracts/session";
import {
	terminalFrameSrcFor,
	terminalThemeFor,
	trustedTerminalFrameMessageFrom,
} from "./terminal-frame-bridge";
import { followTerminalFocus } from "./terminal-focus";

const INITIAL_COLS = 120;
const INITIAL_ROWS = 30;

interface TerminalAppearance {
	readonly mode: "light" | "dark";
	readonly terminal: TerminalPalette | null;
}

const selectTheme = (state: DomainObjectState<typeof Theme>) => state;

/** Without kilo.shell's theme, the document's colour scheme. */
function documentAppearance(): TerminalAppearance {
	return {
		mode: document.documentElement.dataset["theme"] === "dark" ? "dark" : "light",
		terminal: null,
	};
}

function terminalThemeFromApp(appearance: TerminalAppearance, pane: HTMLElement | null) {
	const styles = getComputedStyle(document.documentElement);
	const scrollbarThumb = styles.getPropertyValue("--app-scrollbar-thumb").trim();
	const scrollbarThumbHover = styles.getPropertyValue("--app-scrollbar-thumb-hover").trim();
	const theme = terminalThemeFor(
		appearance.mode,
		{
			...(scrollbarThumb ? { scrollbarThumb } : {}),
			...(scrollbarThumbHover ? { scrollbarThumbHover } : {}),
		},
		appearance.terminal,
	);
	const paneBackground = pane ? getComputedStyle(pane).backgroundColor : "";
	return paneBackground
		? { ...theme, background: paneBackground, cursorAccent: paneBackground }
		: theme;
}

function TerminalNotice({
	qaId,
	icon,
	title,
	description,
}: {
	readonly qaId: string;
	readonly icon: ReactNode;
	readonly title: string;
	readonly description: string;
}) {
	return (
		<div className="bg-pane flex min-h-0 flex-1" data-qa-id={qaId}>
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">{icon}</EmptyMedia>
					<EmptyTitle>{title}</EmptyTitle>
					<EmptyDescription>{description}</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</div>
	);
}

/**
 * A terminal pane: an iframe on the `terminal` embedded host, handed a port
 * to the pane's shell in main once it is ready. The pane id names the shell;
 * a theme change remounts the frame and replays the shell's history.
 */
export function TerminalView({ workSessionId, pane, directory }: PaneProps) {
	const sdk = useSdk();
	const terminals = useDomainObject(Terminals);
	const theme = useDomainObjectState(Theme, selectTheme);
	const viewRef = useRef<HTMLDivElement>(null);
	const frameRef = useRef<HTMLIFrameElement>(null);
	const connectedIdentityRef = useRef<TerminalIdentity | null>(null);
	const appearance: TerminalAppearance = theme ?? documentAppearance();
	const appearanceRef = useRef(appearance);
	appearanceRef.current = appearance;
	const terminalId = pane.id;
	const terminalSessionId = pane.metadata[TERMINAL_SESSION_METADATA_KEY] ?? workSessionId;
	const defaultLabel = `Terminal ${String(pane.ordinal)}`;
	// ponytail: Ghostty 0.4 cannot repaint ANSI palettes. Reconnect to the same
	// PTY and replay its capped history; scroll/selection reset until Ghostty supports live themes.
	const frameKey = JSON.stringify([
		terminalSessionId,
		terminalId,
		appearance.mode,
		appearance.terminal,
	]);
	const frameSrc = useMemo(
		() =>
			terminalFrameSrcFor(
				window.location,
				import.meta.env["VITE_TERMINAL_ORIGIN"] as string | undefined,
			),
		[],
	);
	const [connectionError, setConnectionError] = useState<string | null>(null);
	const available = terminals !== null && frameSrc !== undefined;

	useEffect(() => {
		const frame = frameRef.current;
		if (!available || connectionError || !frame) return;
		return followTerminalFocus(sdk, frame);
	}, [available, connectionError, frameKey, sdk]);

	useEffect(() => {
		if (!available || frameSrc === undefined) return;
		const frameUrl = new URL(frameSrc);
		const frameOrigin = `${frameUrl.protocol}//${frameUrl.host}`;
		let port: MessagePort | null = null;
		let transferred = false;

		const onMessage = (event: MessageEvent<unknown>) => {
			const frameWindow = frameRef.current?.contentWindow;
			const message = trustedTerminalFrameMessageFrom(event, frameWindow ?? null, frameOrigin);
			// Labels reach the pane title from main.
			if (message?.type !== "terminal:ready" || !frameWindow || transferred) return;
			try {
				const reconnecting =
					connectedIdentityRef.current?.sessionId === terminalSessionId &&
					connectedIdentityRef.current.terminalId === terminalId;
				port = sdk.ports.open(TERMINAL_PORT, {
					protocolVersion: TERMINAL_PROTOCOL_VERSION,
					sessionId: terminalSessionId,
					terminalId,
					...(!reconnecting && directory ? { cwd: directory } : {}),
					cols: INITIAL_COLS,
					rows: INITIAL_ROWS,
					initialLabel: defaultLabel,
				});
				frameWindow.postMessage(
					{
						type: "terminal:connect",
						protocolVersion: TERMINAL_PROTOCOL_VERSION,
						theme: terminalThemeFromApp(appearanceRef.current, viewRef.current),
					},
					frameOrigin,
					[port],
				);
				transferred = true;
				connectedIdentityRef.current = { sessionId: terminalSessionId, terminalId };
				setConnectionError(null);
			} catch (error) {
				port?.close();
				port = null;
				setConnectionError(error instanceof Error ? error.message : "Could not open the terminal.");
			}
		};

		window.addEventListener("message", onMessage);
		return () => {
			window.removeEventListener("message", onMessage);
			if (!transferred) port?.close();
		};
	}, [available, defaultLabel, directory, frameKey, frameSrc, sdk, terminalId, terminalSessionId]);

	if (!terminals) {
		return (
			<TerminalNotice
				qaId="terminal-unavailable"
				icon={<SquareTerminalIcon aria-hidden="true" />}
				title="Terminals aren't available here"
				description="Terminals run in the desktop app."
			/>
		);
	}
	if (!frameSrc) {
		return (
			<TerminalNotice
				qaId="terminal-desktop-required"
				icon={<SquareTerminalIcon aria-hidden="true" />}
				title="Terminal unavailable"
				description="Terminal tabs are available in the desktop app."
			/>
		);
	}
	if (connectionError) {
		return (
			<TerminalNotice
				qaId="terminal-connection-error"
				icon={<CircleAlertIcon aria-hidden="true" />}
				title="Could not connect to the terminal"
				description={connectionError}
			/>
		);
	}
	return (
		<div ref={viewRef} className="bg-pane flex min-h-0 flex-1" data-qa-id="terminal-view">
			<iframe
				key={frameKey}
				ref={frameRef}
				src={frameSrc}
				title="Terminal"
				className="bg-pane min-h-0 flex-1 border-0"
				allow="clipboard-read; clipboard-write"
				data-qa-id="terminal-frame"
			/>
		</div>
	);
}

export const TerminalIcon = SquareTerminalIcon;
