import { useEffect, useMemo, useRef, useState } from "react";
import { SquareTerminal } from "lucide-react";

import { useSdk } from "@anaconda-agentic-desktop/sdk-react";

import { TERMINAL_PROTOCOL_VERSION, type TerminalService } from "../contracts/session.js";
import {
	terminalFrameSrcFor,
	terminalThemeFor,
	trustedTerminalFrameMessageFrom,
} from "./terminal-frame-bridge.js";
import type { ChatRightPanelCapabilities } from "./chat-right-panel.js";
import { registerTerminalPaneOwner } from "./terminal-pane-owners.js";

const INITIAL_COLS = 120;
const INITIAL_ROWS = 30;
const TERMINAL_SESSION_METADATA_KEY = "terminalSessionId";

function terminalThemeFromApp(mode: "dark" | "light") {
	const styles = getComputedStyle(document.documentElement);
	const scrollbarThumb = styles.getPropertyValue("--app-scrollbar-thumb").trim();
	const scrollbarThumbHover = styles.getPropertyValue("--app-scrollbar-thumb-hover").trim();
	return terminalThemeFor(mode, {
		...(scrollbarThumb ? { scrollbarThumb } : {}),
		...(scrollbarThumbHover ? { scrollbarThumbHover } : {}),
	});
}

export interface TerminalViewProps {
	readonly sessionId: string;
	readonly instanceId: string;
	readonly title: string;
	readonly workspaceDirectory?: string;
	readonly workspaceFolders?: readonly { readonly path: string; readonly isPrimary: boolean }[];
	readonly metadata?: Readonly<Record<string, string>>;
}

export function TerminalView({
	sessionId,
	instanceId,
	title,
	workspaceFolders,
	metadata,
}: TerminalViewProps) {
	const sdk = useSdk<TerminalService>("terminal");
	const frameRef = useRef<HTMLIFrameElement>(null);
	const connectedWindowRef = useRef<Window | null>(null);
	const primaryWorkspace = workspaceFolders?.find(({ isPrimary }) => isPrimary)?.path;
	const panel = sdk.plugins.get<ChatRightPanelCapabilities>("kilo-ui")?.chatRightPanel;
	const ordinal = panel
		?.listTabs?.(sessionId)
		.find((tab) => tab.instanceId === instanceId)?.ordinal;
	const defaultLabel = ordinal ? `Terminal ${String(ordinal)}` : title;
	const terminalSessionId = metadata?.[TERMINAL_SESSION_METADATA_KEY] ?? sessionId;
	const frameSrc = useMemo(
		() =>
			terminalFrameSrcFor(
				window.location,
				import.meta.env["VITE_TERMINAL_ORIGIN"] as string | undefined,
			),
		[],
	);
	const [connectionError, setConnectionError] = useState<string | null>(null);

	useEffect(
		() =>
			registerTerminalPaneOwner({
				paneSessionId: sessionId,
				terminalSessionId,
				terminalId: instanceId,
			}),
		[instanceId, sessionId, terminalSessionId],
	);

	useEffect(() => {
		panel?.updateTab?.(sessionId, instanceId, {
			title: defaultLabel,
			...(!metadata?.[TERMINAL_SESSION_METADATA_KEY]
				? {
						metadata: {
							...metadata,
							[TERMINAL_SESSION_METADATA_KEY]: terminalSessionId,
						},
					}
				: {}),
		});
		return panel?.registerTabLifecycle?.(sessionId, instanceId, {
			onClose: () =>
				sdk.client.close({
					sessionId: terminalSessionId,
					terminalId: instanceId,
					deleteHistory: true,
				}),
		});
	}, [defaultLabel, instanceId, metadata, panel, sdk, sessionId, terminalSessionId]);

	useEffect(() => {
		if (!frameSrc) return;
		const frameUrl = new URL(frameSrc);
		const frameOrigin = `${frameUrl.protocol}//${frameUrl.host}`;
		let port: MessagePort | null = null;
		let transferred = false;

		const onMessage = (event: MessageEvent<unknown>) => {
			const frameWindow = frameRef.current?.contentWindow;
			const message = trustedTerminalFrameMessageFrom(event, frameWindow ?? null, frameOrigin);
			if (!message) return;
			if (message.type === "terminal:label") {
				panel?.updateTab?.(sessionId, instanceId, { title: message.label });
				return;
			}
			if (!frameWindow || transferred) return;
			try {
				port = sdk.ports.open<MessagePort>("session", {
					protocolVersion: TERMINAL_PROTOCOL_VERSION,
					sessionId: terminalSessionId,
					terminalId: instanceId,
					...(primaryWorkspace ? { cwd: primaryWorkspace } : {}),
					cols: INITIAL_COLS,
					rows: INITIAL_ROWS,
					initialLabel: defaultLabel,
				});
				frameWindow.postMessage(
					{
						type: "terminal:connect",
						protocolVersion: TERMINAL_PROTOCOL_VERSION,
						theme: terminalThemeFromApp(sdk.theme.peek()),
					},
					frameOrigin,
					[port],
				);
				transferred = true;
				connectedWindowRef.current = frameWindow;
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
	}, [
		defaultLabel,
		frameSrc,
		instanceId,
		panel,
		primaryWorkspace,
		sdk,
		sessionId,
		terminalSessionId,
	]);

	useEffect(() => {
		if (!frameSrc) return;
		const frameUrl = new URL(frameSrc);
		const frameOrigin = `${frameUrl.protocol}//${frameUrl.host}`;
		const unsubscribeTheme = sdk.theme.subscribe((mode) => {
			connectedWindowRef.current?.postMessage(
				{
					type: "terminal:theme",
					protocolVersion: TERMINAL_PROTOCOL_VERSION,
					theme: terminalThemeFromApp(mode),
				},
				frameOrigin,
			);
		});
		return () => {
			unsubscribeTheme();
			connectedWindowRef.current = null;
		};
	}, [frameSrc, sdk]);

	if (!frameSrc) {
		return (
			<div
				className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm"
				data-qa-id="terminal-desktop-required"
			>
				Terminal tabs are available in the desktop app.
			</div>
		);
	}
	if (connectionError) {
		return (
			<div
				className="text-destructive flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm"
				data-qa-id="terminal-connection-error"
			>
				{connectionError}
			</div>
		);
	}
	return (
		<iframe
			ref={frameRef}
			src={frameSrc}
			title="Terminal"
			className="min-h-0 flex-1 border-0"
			allow="clipboard-read; clipboard-write"
			data-qa-id="terminal-frame"
		/>
	);
}

export const TerminalIcon = SquareTerminal;
