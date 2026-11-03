import type { ServerConnection } from "@kilo-desktop/plugin-agent/contracts";

import { directoryClient } from "../runtime/kilo-client";
import { SNAPSHOT_INITIALIZATION, type PromptModelRef } from "../runtime/prompt-options";
import { withMcpWarmup } from "../runtime/with-mcp-warmup";

/**
 * In-place re-prompt (PyCharm retry semantics): the server rewrites the
 * original user message (empty parts, same messageID) and starts a fresh
 * assistant turn — no revert, no duplicate prompt. The assistant-ui runtime
 * is bypassed; the patched controller picks the new turn up from the event
 * stream like an externally-driven one. The workspace system prompt fresh
 * prompts carry is not re-sent (it lives in the runtime's prompt options).
 */
export async function retryFailedTurn({
	connection,
	sessionID,
	directory,
	messageID,
	model,
}: {
	connection: ServerConnection;
	sessionID: string;
	directory: string;
	messageID: string;
	model?: PromptModelRef | undefined;
}): Promise<void> {
	await withMcpWarmup(directoryClient(connection, directory)).session.promptAsync(
		{
			sessionID,
			messageID,
			parts: [],
			...(model ? { model } : {}),
			snapshotInitialization: SNAPSHOT_INITIALIZATION,
		},
		{ throwOnError: true },
	);
}
