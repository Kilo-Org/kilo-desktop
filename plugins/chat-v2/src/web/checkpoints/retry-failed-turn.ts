import type { KiloClient, ModelRef } from "@kilo-desktop/react-opencode-v2";

import type { ServerConnection } from "@kilo-desktop/plugin-core/contracts";

import { kiloClient } from "../runtime/kilo-client";
import { withMcpWarmup } from "../runtime/with-mcp-warmup";

type PromptFiles = NonNullable<Parameters<KiloClient["session"]["prompt"]>[0]["files"]>;

/**
 * Retries a failed turn: switches the chat to `model` (when given, with its
 * reasoning effort) and sends the turn's user message — its text and files —
 * again as a new prompt, so the transcript shows it twice. The id isn't reused: kilo2 admits a prompt
 * once per message id, and re-admitting the failed turn's message only wakes
 * the session, which finds no new input and doesn't ask the model again.
 * The assistant-ui runtime is bypassed; the controller picks the turn up
 * from the event stream like an externally-driven one. The workspace system
 * note fresh prompts carry is not re-sent (the chat already holds it).
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
	model?: ModelRef | undefined;
}): Promise<void> {
	const client = withMcpWarmup(kiloClient(connection), directory);
	const message = await client.session.message.get({ sessionID, messageID });
	if (message.type !== "user") throw new Error(`${messageID} is not a prompt to retry`);
	if (model) await client.session.switchModel({ sessionID, model });
	const files: PromptFiles = (message.files ?? []).map((file) => ({
		uri: file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`,
		source: file.source,
		...(file.name !== undefined ? { name: file.name } : {}),
	}));
	await client.session.prompt({
		sessionID,
		text: message.text,
		...(files.length > 0 ? { files } : {}),
	});
}
