import type { KiloGlobalConnection } from "../../../../contracts/chat/schemas.js";
import { createKiloDirectoryClient } from "../../runtime/create-kilo-runtime-client.js";
import { withMcpWarmup } from "../../runtime/with-mcp-warmup.js";
import { SNAPSHOT_INITIALIZATION, type PromptModelRef } from "../../runtime/with-prompt-options.js";

/**
 * In-place re-prompt (PyCharm retry semantics): the server rewrites the
 * original user message (empty parts, same messageID) and starts a fresh
 * assistant turn — no revert, no duplicate prompt. The assistant-ui runtime
 * is deliberately bypassed; the patched controller picks the new turn up via
 * SSE like an externally-driven one.
 *
 * Known limitation: this path does not re-inject the workspace system prompt
 * that `withPromptOptions` adds to fresh prompts — that getter lives inside
 * the runtime backend closure. Acceptable for the auth-failure scenario; if
 * retried turns lose workspace context, thread `getSystem` through instead.
 */
export async function retryFailedTurn({
	connection,
	sessionID,
	directory,
	messageID,
	model,
}: {
	connection: KiloGlobalConnection;
	sessionID: string;
	directory: string;
	messageID: string;
	model?: PromptModelRef;
}): Promise<void> {
	const client = withMcpWarmup(createKiloDirectoryClient(connection, directory));
	await client.session.promptAsync(
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
