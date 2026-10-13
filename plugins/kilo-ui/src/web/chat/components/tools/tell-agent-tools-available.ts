import type { KiloGlobalConnection } from "../../../../contracts/chat/schemas.js";
import { createKiloDirectoryClient } from "../../runtime/create-kilo-runtime-client.js";

/**
 * Tell the agent in a session that tools the user declined are available
 * again because they signed in. The agent's history says the tools are off,
 * and a tool list that changes silently does not override that, so it keeps
 * using the shell. The note is a reply-less (`noReply`) user message whose
 * synthetic, background text the chat does not render: the agent reads it
 * with the user's next message.
 */
export async function tellAgentToolsAvailable({
	connection,
	sessionID,
	directory,
	toolsLabel,
}: {
	connection: KiloGlobalConnection;
	sessionID: string;
	directory: string;
	toolsLabel: string;
}): Promise<void> {
	const client = createKiloDirectoryClient(connection, directory);
	await client.session.prompt(
		{
			sessionID,
			noReply: true,
			parts: [
				{
					type: "text",
					synthetic: true,
					metadata: { background: true },
					text:
						`[Kilo Desktop] The user has signed in to Kilo, so ${toolsLabel} are available ` +
						"again and back in your tool list. From now on, use them instead of running the " +
						"equivalent commands in a shell, even though the user declined to sign in earlier.",
				},
			],
		},
		{ throwOnError: true },
	);
}
