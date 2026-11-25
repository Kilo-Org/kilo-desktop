import type { SessionInfo } from "@kilocode/client";

import type { OpenCodeRuntimeBackend } from "./types";

const mapThreadMetadata = (session: Pick<SessionInfo, "id" | "title" | "time">) => ({
	status: typeof session.time.archived === "number" ? ("archived" as const) : ("regular" as const),
	remoteId: session.id,
	externalId: session.id,
	title: session.title ?? "",
});

export const createOpenCodeThreadListAdapter = (
	backend: OpenCodeRuntimeBackend,
	getSessionTitle: (sessionId: string) => string | undefined = () => undefined,
) => ({
	list: async (params?: { after?: string }) => {
		if (backend.listSessionPage) {
			const page = await backend.listSessionPage(params?.after ? { after: params.after } : {});
			return {
				threads: page.sessions.filter((session) => !session.parentID).map(mapThreadMetadata),
				...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
			};
		}
		const page = await backend.globalClient.session.list({ parentID: null });
		const sessions = new Map<string, SessionInfo>();

		for (const session of page.data) {
			if (session.parentID) continue;
			backend.getSessionClient({ id: session.id, directory: session.location.directory });
			sessions.set(session.id, session);
		}

		return {
			threads: [...sessions.values()].map(mapThreadMetadata),
		};
	},
	rename: async (remoteId: string, newTitle: string) => {
		// Mirroring session.title into the list must not echo it back to the
		// server (and must not race a freshly generated title).
		if (getSessionTitle(remoteId)?.trim() === newTitle) return;
		await backend
			.getSessionClient({ id: remoteId })
			.session.update({ sessionID: remoteId, title: newTitle });
	},
	archive: async (remoteId: string) => {
		await backend
			.getSessionClient({ id: remoteId })
			.session.update({ sessionID: remoteId, archived: true });
	},
	unarchive: async (remoteId: string) => {
		await backend
			.getSessionClient({ id: remoteId })
			.session.update({ sessionID: remoteId, archived: false });
	},
	delete: async (remoteId: string) => {
		await backend.getSessionClient({ id: remoteId }).session.remove({ sessionID: remoteId });
	},
	initialize: async () => {
		const session = await backend.initializeSession();
		if (!session.id) {
			throw new Error("Failed to create OpenCode session");
		}
		backend.getSessionClient(session);
		return {
			remoteId: session.id,
			externalId: session.id,
		};
	},
	// RemoteThreadList calls generateTitle on the first runEnd and replaces the
	// list title with the streamed text — an empty stream would clear it. Stream
	// the session's own title so Kilo stays the source of truth.
	generateTitle: async (remoteId: string) => {
		const title = getSessionTitle(remoteId)?.trim();
		return new ReadableStream({
			start(controller) {
				if (title) {
					controller.enqueue({ type: "part-start", path: [0], part: { type: "text" } });
					controller.enqueue({ type: "text-delta", path: [0], textDelta: title });
					controller.enqueue({ type: "part-finish", path: [0] });
				}
				controller.close();
			},
		});
	},
	fetch: async (threadId: string) => {
		const session = await backend
			.getSessionClient({ id: threadId })
			.session.get({ sessionID: threadId });
		if (!session?.id) {
			throw new Error("OpenCode session not found");
		}
		backend.getSessionClient({ id: session.id, directory: session.location.directory });
		return mapThreadMetadata(session);
	},
});
