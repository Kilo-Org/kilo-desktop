import type { MainSdk } from "@kilo-desktop/feature-sdk/main";

import { SESSIONS_CHANGED_EVENT, sessionsContract } from "../../contracts/sessions/schemas.js";
import type { WorkspacesDatabase } from "../workspaces/db.js";
import { SessionService } from "./SessionService.js";

/**
 * Serves the work sessions over IPC. Main is the single writer; every change
 * emits `sessions-changed` so each window's mirror refetches. Adopting chats
 * also re-keys the board cards saved under their Kilo session ids, since main
 * owns the board too; the renderer re-keys the state it keeps itself.
 */
export function registerSessions(
	mainSdk: MainSdk,
	db: WorkspacesDatabase,
	board: { renameSessions: (renames: Readonly<Record<string, string>>) => void },
	service: SessionService = new SessionService(db),
): void {
	const changed = () => mainSdk.events.emit(SESSIONS_CHANGED_EVENT, undefined);

	mainSdk.channels(sessionsContract).handleAll({
		"sessions.list": async () => ({ sessions: service.list() }),
		"sessions.attachChat": async ({ sessionId, kiloSessionId }) => {
			const session = service.attachChat(sessionId, kiloSessionId);
			changed();
			return session;
		},
		"sessions.adoptChats": async ({ kiloSessionIds }) => {
			const adopted = service.adoptChats(kiloSessionIds);
			if (Object.keys(adopted).length === 0) return { adopted };
			try {
				board.renameSessions(adopted);
			} catch (error) {
				mainSdk.logger.error("Could not move board cards to their adopted sessions.", error);
			}
			changed();
			return { adopted };
		},
		"sessions.delete": async ({ sessionId }) => {
			const deleted = service.delete(sessionId);
			if (deleted) changed();
			return { deleted };
		},
		"sessions.detachChat": async ({ kiloSessionId }) => {
			const { unlinked, deletedSessionId } = service.detachChat(kiloSessionId);
			if (unlinked) changed();
			return { deletedSessionId };
		},
	});
}
