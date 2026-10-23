import { useAuiState } from "@assistant-ui/react";
import { useEffect } from "react";

import { useSessions, useSessionsSync } from "./SessionsProvider.js";

const NO_THREADS: readonly { readonly remoteId?: string | undefined }[] = [];

/**
 * Gives every listed chat that no session owns a session of its own (chats
 * from before work sessions existed, or created by another Kilo client), as
 * soon as it is listed. Lives in the main window only, so one window adopts.
 * Waits for the saved sessions to load, so it never adopts an owned chat.
 */
export function SessionChatAdoption() {
	const threadItems = useAuiState((state) => state.threads?.threadItems ?? NO_THREADS);
	const loaded = useSessions((state) => state.loaded);
	const sessionIdByChat = useSessions((state) => state.sessionIdByChat);
	const sync = useSessionsSync();

	useEffect(() => {
		if (!loaded || !sync) return;
		const unowned = threadItems.flatMap((item) =>
			item.remoteId && !sessionIdByChat[item.remoteId] ? [item.remoteId] : [],
		);
		if (unowned.length > 0) sync.adoptChats(unowned);
	}, [loaded, sessionIdByChat, sync, threadItems]);

	return null;
}
