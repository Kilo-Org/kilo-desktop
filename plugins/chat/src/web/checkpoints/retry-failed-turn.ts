import type { ServerConnection } from "@kilo-desktop/plugin-core/contracts";

import { kiloClient } from "../runtime/kilo-client";
import { applySelection, toModelRef, type PromptModelRef } from "../runtime/prompt-options";
import { warmMcp } from "../runtime/with-mcp-warmup";

/**
 * Retries a failed turn by sending its user prompt again: the text and files
 * of `messageID` as a new `session.prompt`, with the pane's model switched
 * in first. v2 rewrites no message in place (v1 re-prompted the same message
 * id) and offers no retry, so the prompt shows again in the transcript. The
 * assistant-ui runtime is bypassed; the forked controller picks the new turn
 * up from the event stream like an externally-driven one. The chat's system
 * prompt fresh prompts carry is not re-sent (it lives in the runtime's prompt
 * options).
 */
export async function retryFailedTurn({
	connection,
	sessionID,
	messageID,
	model,
}: {
	connection: ServerConnection;
	sessionID: string;
	messageID: string;
	model?: PromptModelRef | undefined;
}): Promise<void> {
	const client = kiloClient(connection);
	const [session, message] = await Promise.all([
		client.session.get({ sessionID }),
		client.session.message.get({ sessionID, messageID }),
	]);
	if (message.type !== "user") throw new Error(`Message ${messageID} isn't a prompt.`);
	// The pane's model carries no variant: the session's is kept for the same model.
	const current = session.model;
	const variant =
		current?.providerID === model?.providerID && current?.id === model?.modelID
			? current?.variant
			: undefined;
	await applySelection(client, session, model ? { model: toModelRef(model, variant) } : {});
	warmMcp(client, session.location.directory);
	const files = (message.files ?? []).map((file) => ({
		uri: `data:${file.mime};base64,${file.data}`,
		...(file.name ? { name: file.name } : {}),
	}));
	await client.session.prompt({
		sessionID,
		text: message.text,
		...(files.length > 0 ? { files } : {}),
	});
}
