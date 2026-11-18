import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type { Panes, WorkSessions } from "@kilo-desktop/plugin-work-sessions/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { AGENT_PANE_KIND, chatPaneObject } from "../../contracts";

export type ForkPhase = "forking" | "opening";

export interface ForkChatInput {
	readonly workSessions: DomainObjectHandle<typeof WorkSessions> | null | undefined;
	readonly panes: DomainObjectHandle<typeof Panes> | null | undefined;
	readonly workSessionId: string;
	readonly chatId: string;
	readonly messageId: string;
	readonly onPhase: (phase: ForkPhase | null) => void;
	/** Reports the attempt once: whether the fork was made and opened. */
	readonly track: (success: boolean) => void;
}

/**
 * Forks a chat at a user message into the same work session, then opens the
 * fork as a tab in the work session's main window and makes it active. Holds
 * no pane state, so it finishes even when the source pane closes meanwhile.
 * Failures are toasted; nothing is opened for a fork that failed.
 */
export async function forkChat(input: ForkChatInput): Promise<void> {
	const { workSessions, panes, workSessionId, chatId, messageId, onPhase, track } = input;
	let success = false;
	onPhase("forking");
	try {
		const chat = await workSessions?.methods
			.forkChat({ id: workSessionId, chatId, messageId })
			.catch(() => undefined);
		if (!chat) {
			toast.error("Could not fork the chat.");
			return;
		}
		onPhase("opening");
		const opened = await panes?.methods
			.open({
				workSessionId,
				kind: AGENT_PANE_KIND,
				object: chatPaneObject(chat.id),
				placement: "tab",
			})
			.catch(() => undefined);
		if (!opened) {
			toast.error("Could not open the forked chat.");
			return;
		}
		success = true;
	} finally {
		onPhase(null);
		track(success);
	}
}
