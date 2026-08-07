import { Thread } from "./components/assistant-ui/thread.js";
import { useChatConnection } from "./connection/ChatConnectionContext.js";

/**
 * Full-page chat surface contributed by kilo-ui (`/plugins/chat`).
 * Connection and `AssistantRuntimeProvider` live in `ChatFeatureProvider`
 * so the shell sidebar ThreadList shares the same runtime.
 */
export function ChatPage() {
	const connection = useChatConnection();

	return (
		<>
			{connection.isError ? (
				<p className="text-destructive px-6 pt-4 text-sm" role="alert" data-qa-id="kilo-chat-error">
					Could not connect to Kilo:{" "}
					{connection.error instanceof Error ? connection.error.message : String(connection.error)}
				</p>
			) : null}
			<div className="flex h-full min-h-0 flex-col" data-qa-id="kilo-chat-thread">
				<Thread />
			</div>
		</>
	);
}
