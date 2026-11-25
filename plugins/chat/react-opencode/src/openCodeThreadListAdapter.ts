import type { SessionInfo } from "@kilocode/client";

import type { OpenCodeRuntimeBackend } from "./types";

const mapThreadMetadata = (session: Pick<SessionInfo, "id" | "title" | "time">) => ({
	status: typeof session.time.archived === "number" ? ("archived" as const) : ("regular" as const),
	remoteId: session.id,
	externalId: session.id,
	title: session.title ?? "",
});

/** Rows per `session.list` page, when the host lists no sessions itself. */
const LIST_PAGE_SIZE = 100;

export const createOpenCodeThreadListAdapter = (
	backend: OpenCodeRuntimeBackend,
	getSessionTitle: (sessionId: string) => string | undefined = () => undefined,
) => {
	const { client } = backend;
	return {
		list: async (params?: { after?: string }) => {
			if (backend.listSessionPage) {
				const page = await backend.listSessionPage(params?.after ? { after: params.after } : {});
				return {
					threads: page.sessions.filter((session) => !session.parentID).map(mapThreadMetadata),
					...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
				};
			}
			const page = await client.session.list(
				params?.after
					? { cursor: params.after, limit: LIST_PAGE_SIZE }
					: { parentID: null, limit: LIST_PAGE_SIZE },
			);
			const next =
				page.data.length === LIST_PAGE_SIZE ? (page.cursor.next ?? undefined) : undefined;
			return {
				threads: page.data.map(mapThreadMetadata),
				...(next ? { nextCursor: next } : {}),
			};
		},
		rename: async (remoteId: string, newTitle: string) => {
			// Mirroring the session's title into the list must not echo it back.
			if (getSessionTitle(remoteId)?.trim() === newTitle) return;
			await client.session.update({ sessionID: remoteId, title: newTitle });
		},
		archive: async (remoteId: string) => {
			await client.session.update({ sessionID: remoteId, archived: true });
		},
		unarchive: async (remoteId: string) => {
			await client.session.update({ sessionID: remoteId, archived: false });
		},
		delete: async (remoteId: string) => {
			await client.session.remove({ sessionID: remoteId });
		},
		initialize: async () => {
			const session = await backend.initializeSession();
			if (!session.id) throw new Error("Failed to create the Kilo session");
			return { remoteId: session.id, externalId: session.id };
		},
		// RemoteThreadList calls generateTitle on the first runEnd and replaces the
		// list title with the streamed text: an empty stream would clear it. Stream
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
		fetch: async (threadId: string) =>
			mapThreadMetadata(await client.session.get({ sessionID: threadId })),
	};
};
