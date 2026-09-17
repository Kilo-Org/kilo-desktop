import { useEffect, useRef } from "react";

import { toast } from "@anaconda-agentic-desktop/ui/components/sonner";

import { useChatConnection } from "./connection/ChatConnectionContext.js";

const TOAST_ID = "kilo-server-error";
const TOAST_TITLE = "Kilo server error";

/**
 * Clean a single stderr line for display: strip the leading "Error: " prefix
 * and the "↳ " leader that the kilo CLI uses for sub-items, then ensure the
 * line ends with a period.
 */
function cleanLine(raw: string): string {
	let line = raw.replace(/^Error:\s*/i, "").replace(/^↳\s*/, "");
	line = line.trim();
	if (line && !/[.!?]$/.test(line)) line += ".";
	return line;
}

/**
 * Parse a connection error message into a user-friendly description. The
 * server manager concatenates the base error and the captured stderr with a
 * newline separator. The base error is a generic operational message (e.g.
 * "Kilo server exited before becoming ready (code 1).") while the stderr
 * carries the actual root cause. When stderr is present, the base message
 * is dropped and the stderr lines are cleaned up for readability.
 */
export function formatServerError(message: string): string {
	const newlineIndex = message.indexOf("\n");
	if (newlineIndex === -1) return message;
	const stderrBlock = message.slice(newlineIndex + 1).trim();
	if (!stderrBlock) return message;
	return stderrBlock.split("\n").map(cleanLine).filter(Boolean).join("\n");
}

/**
 * True when the error is a capability-missing message (e.g. browser mode)
 * rather than an actual server startup failure. These are expected in
 * non-Electron environments and already surfaced by dedicated UI (account
 * panel, provider settings), so the toast would be redundant and can
 * intercept pointer events in the sidebar.
 */
function isExpectedCapabilityError(message: string): boolean {
	return message.includes("requires the desktop app");
}

/**
 * Renderless component that shows a persistent error toast when the Kilo
 * server connection fails. Displays the root cause (e.g. config validation
 * errors) prominently so users can fix their config without hunting through
 * log files. Dismissed automatically when the connection recovers.
 */
export function KiloServerErrorToast() {
	const connection = useChatConnection();
	const shownForRef = useRef<string | null>(null);

	useEffect(() => {
		if (connection.isError && connection.error) {
			const message = connection.error.message;
			if (isExpectedCapabilityError(message)) return;
			if (shownForRef.current === message) return;
			shownForRef.current = message;
			const description = formatServerError(message);
			toast.error(TOAST_TITLE, {
				id: TOAST_ID,
				description,
				duration: Number.POSITIVE_INFINITY,
				closeButton: true,
			});
			return;
		}
		if (shownForRef.current !== null) {
			shownForRef.current = null;
			toast.dismiss(TOAST_ID);
		}
	}, [connection.isError, connection.error]);

	useEffect(
		() => () => {
			toast.dismiss(TOAST_ID);
		},
		[],
	);

	return null;
}
