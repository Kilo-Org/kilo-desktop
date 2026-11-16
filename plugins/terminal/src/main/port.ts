import type { KernelLogger, KernelPort, PortHandler } from "@kilo-desktop/kernel";

import {
	terminalConnectionArgsSchema,
	type TerminalConnectionArgs,
	type TerminalServerMessage,
} from "../contracts/session";

export interface TerminalAttacher {
	attach(port: KernelPort, args: TerminalConnectionArgs): Promise<void>;
}

/**
 * Handles a frame's `session` port: validates its arguments and attaches it
 * to its terminal once `ready` settles. A refused connection is told why in
 * the protocol's own error message, then closed.
 */
export function createTerminalPortHandler(
	manager: TerminalAttacher,
	ready: Promise<void>,
	logger: Pick<KernelLogger, "warn">,
): PortHandler {
	const refuse = (port: KernelPort, message: string) => {
		port.postMessage({ type: "error", message } satisfies TerminalServerMessage);
		port.close();
	};
	return (port, args) => {
		const parsed = terminalConnectionArgsSchema.safeParse(args);
		if (!parsed.success) {
			logger.warn("Refused a terminal connection with invalid arguments.");
			refuse(port, "Invalid terminal connection.");
			return;
		}
		void ready
			.then(() => manager.attach(port, parsed.data))
			.catch((error: unknown) => {
				refuse(port, error instanceof Error ? error.message : "Could not open the terminal.");
			});
	};
}
