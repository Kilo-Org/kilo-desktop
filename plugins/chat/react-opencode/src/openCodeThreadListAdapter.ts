import { type GlobalSession } from "@kilocode/sdk/v2/client";
import { OPEN_CODE_REQUEST_OPTIONS } from "./openCodeRequestOptions";
import type { OpenCodeRuntimeBackend } from "./types";

const isArchivedSession = (session: Pick<GlobalSession, "time">) => {
	return typeof session.time.archived === "number";
};

const mapThreadMetadata = (session: {
	id: string;
	title: string;
	time: { archived?: number };
}) => ({
	status: isArchivedSession(session as GlobalSession)
		? ("archived" as const)
		: ("regular" as const),
	remoteId: session.id,
	externalId: session.id,
	title: session.title,
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
		const response = await backend.globalClient.experimental.session.list(
			{
				roots: true,
				archived: true,
			},
			OPEN_CODE_REQUEST_OPTIONS,
		);
		const sessions = new Map<string, GlobalSession>();

		for (const session of response.data ?? []) {
			if (session.parentID) continue;
			backend.getSessionClient({ id: session.id, directory: session.directory });
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
		await backend.getSessionClient({ id: remoteId }).session.update(
			{
				sessionID: remoteId,
				title: newTitle,
			},
			OPEN_CODE_REQUEST_OPTIONS,
		);
	},
	archive: async (remoteId: string) => {
		await backend.getSessionClient({ id: remoteId }).session.update(
			{
				sessionID: remoteId,
				time: { archived: Date.now() },
			},
			OPEN_CODE_REQUEST_OPTIONS,
		);
	},
	unarchive: async (remoteId: string) => {
		await backend.getSessionClient({ id: remoteId }).session.update(
			{
				sessionID: remoteId,
				// The SDK models archived timestamps as numbers, but OpenCode uses
				// `null` here to clear the archived flag when unarchiving.
				time: { archived: null as never } as never,
			},
			OPEN_CODE_REQUEST_OPTIONS,
		);
	},
	delete: async (remoteId: string) => {
		await backend.getSessionClient({ id: remoteId }).session.delete(
			{
				sessionID: remoteId,
			},
			OPEN_CODE_REQUEST_OPTIONS,
		);
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
		const response = await backend.getSessionClient({ id: threadId }).session.get(
			{
				sessionID: threadId,
			},
			OPEN_CODE_REQUEST_OPTIONS,
		);
		if (!response.data?.id) {
			throw new Error("OpenCode session not found");
		}
		backend.getSessionClient({
			id: response.data.id,
			directory: (response.data as GlobalSession).directory,
		});
		return mapThreadMetadata(response.data as GlobalSession);
	},
});
