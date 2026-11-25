import type { CommandHandler } from "@kilo-desktop/kernel";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { slashCommandHandler } from "../../contracts";
import type { ChatServices } from "../runtime/chat-services";

/** The message a failed Kilo request carries: an `Error`, or the server's error body. */
function failureMessage(error: unknown): string | undefined {
	if (error instanceof Error) return error.message || undefined;
	const body = error as { message?: unknown; data?: { message?: unknown } } | null;
	const message = body?.data?.message ?? body?.message;
	return typeof message === "string" && message ? message : undefined;
}

/**
 * The `kilo.chat/compact` command, placed in the `/` menu as `/compact`:
 * asks Kilo to summarize the chat so far (`session.compact`), freeing up its
 * context window, as Kilo's other clients do (the server doesn't run
 * `compact` through `session.command`). v2 compacts with the session's own
 * model and takes none of its own, so the pane's choice isn't sent. It
 * refuses, with a toast, on a chat that hasn't started or is mid-turn: the
 * server would fold the compaction into the running turn and end it early.
 * Once the server accepts, its progress and errors show in the transcript.
 */
export function createCompactCommand(chat: ChatServices): CommandHandler {
	return slashCommandHandler(async ({ chatId, running }) => {
		if (!chatId) {
			toast.info("Nothing to compact yet", { description: "Send a message first." });
			return;
		}
		if (running) {
			toast.info("Wait for the agent to finish", {
				description: "A chat can be compacted between turns.",
			});
			return;
		}
		try {
			const client = await chat.kiloClient();
			await client.session.compact({ sessionID: chatId });
		} catch (error) {
			toast.error("Couldn't compact the chat", { description: failureMessage(error) });
		}
	});
}
