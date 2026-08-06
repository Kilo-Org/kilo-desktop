import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { MessageSquareIcon } from "lucide-react";

import { useSdk, useSdkQuery } from "@anaconda-agentic-desktop/sdk-react";

import type { KiloCodeService, KiloWorkspaceConnection } from "../contracts/schemas.js";
import { Thread } from "./components/assistant-ui/thread.js";
import { useKiloRuntime } from "./runtime/use-kilo-runtime.js";

/**
 * Nav icon for the kilo-code chat route (plugin.json `nav[].icon`).
 */
export const ChatNavIcon = MessageSquareIcon;

function ChatThread({ connection }: { connection: KiloWorkspaceConnection }) {
	const runtime = useKiloRuntime({ connection });
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<div className="flex h-full min-h-0 flex-col" data-qa-id="kilo-chat-thread">
				<Thread />
			</div>
		</AssistantRuntimeProvider>
	);
}

/**
 * Full-page chat surface contributed by kilo-code (`/plugins/chat`).
 * Uses an unscoped Kilo directory — no workspace picker yet.
 */
export function ChatPage() {
	const sdk = useSdk<KiloCodeService>("kilo-code");
	const connection = useSdkQuery(sdk, "server.getConnection", { scope: "unscoped" });

	if (connection.isPending) {
		return (
			<p className="text-muted-foreground p-6 text-sm" data-qa-id="kilo-chat-loading">
				Connecting to Kilo…
			</p>
		);
	}

	if (connection.isError) {
		return (
			<p className="text-destructive p-6 text-sm" role="alert" data-qa-id="kilo-chat-error">
				Could not connect to Kilo: {connection.error.message}
			</p>
		);
	}

	if (!connection.data) {
		return null;
	}

	return <ChatThread connection={connection.data} />;
}
