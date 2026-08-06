import { AssistantRuntimeProvider, useAui, useAuiState } from "@assistant-ui/react";
import { MessageSquareIcon } from "lucide-react";
import { useEffect, type FC } from "react";

import { useSdk, useSdkQuery } from "@anaconda-agentic-desktop/sdk-react";

import type { KiloCodeService, KiloWorkspaceConnection } from "../contracts/schemas.js";
import { Thread } from "./components/assistant-ui/thread.js";
import { useKiloRuntime } from "./runtime/use-kilo-runtime.js";

/**
 * Nav icon for the kilo-code chat route (plugin.json `nav[].icon`).
 */
export const ChatNavIcon = MessageSquareIcon;

/**
 * `@assistant-ui/react-opencode` keeps the composer disabled until the
 * RemoteThreadList item has a remote session id. The official with-opencode
 * example creates that via the thread-list "New" control; we have no thread
 * list yet, so initialize eagerly or the input stays disabled.
 */
const EnsureKiloSession: FC = () => {
	const aui = useAui();
	const status = useAuiState((s) => s.threadListItem.status);
	const remoteId = useAuiState((s) => s.threadListItem.remoteId);

	useEffect(() => {
		if (status !== "new" || remoteId) return;
		void aui.threadListItem.initialize().catch((error: unknown) => {
			console.error("[ChatPage] Failed to initialize Kilo session", error);
		});
	}, [aui, status, remoteId]);

	return null;
};

function ChatThread({ connection }: { connection: KiloWorkspaceConnection }) {
	const runtime = useKiloRuntime({ connection });
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<EnsureKiloSession />
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
