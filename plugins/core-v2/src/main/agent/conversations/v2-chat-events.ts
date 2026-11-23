import type { OpenCodeEvent, SessionInfo } from "@kilocode/client";

import type { KiloEvent } from "./activity";

/**
 * Kilo v2's sessions and events in the v1 shapes the conversations area
 * reads (`activity.ts`, `store.ts`, `user-messages.ts`), so that logic stays
 * as in v1.
 *
 * v2 reports a session's changes as small events (`session.renamed`,
 * `.metadata.updated`, `.archived`, …) and a fork as `session.forked`, where
 * v1 sent the whole session in `session.created` / `session.updated`; those
 * are answered by reading the session again. A turn is
 * `session.execution.started` … `.succeeded` / `.failed` / `.interrupted`
 * (v2 sends no `session.status` while it runs), questions are forms, a user
 * message is a `user` item entering the session's inbox, and the drain RPC's
 * acknowledgement is an RPC event.
 */

/** A v2 session as the v1 session object `readChatInfo` reads; its directory is its location. */
export function toV1Session(info: SessionInfo): Record<string, unknown> {
	return {
		id: info.id,
		title: info.title ?? "",
		...(info.parentID ? { parentID: info.parentID } : {}),
		directory: info.location.directory,
		metadata: info.metadata ?? null,
		time: info.time,
	};
}

/** Reads a session again; undefined when it is gone. */
export type ReadSession = (sessionID: string) => Promise<SessionInfo | undefined>;

const DRAINED = "rpc.kilocode.session-drain.drained";

/** Events that change a session's own fields, answered by reading it again. */
const SESSION_CHANGES: ReadonlySet<string> = new Set([
	"session.renamed",
	"session.metadata.updated",
	"session.archived",
	"session.unarchived",
	"session.moved",
	"session.permissions",
]);

function idle(sessionID: string): KiloEvent {
	return { type: "session.status", properties: { sessionID, status: { type: "idle" } } };
}

/** One v2 event as the v1 events it stands for; none when nothing here reads it. */
export async function translateEvent(
	event: OpenCodeEvent,
	readSession: ReadSession,
): Promise<KiloEvent[]> {
	const directory = event.location?.directory;
	const at = (type: string, properties: Record<string, unknown>): KiloEvent =>
		directory ? { type, properties, directory } : { type, properties };
	const data = event.data as Record<string, unknown>;
	const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined;

	if (event.type === "server.connected") return [at("server.connected", {})];
	if (event.type === DRAINED) return [at("session.drained", { ...data })];
	if (event.type === "session.created" || event.type === "session.forked") {
		const info = sessionID ? await readSession(sessionID) : undefined;
		return info ? [at("session.created", { info: toV1Session(info) })] : [];
	}
	if (SESSION_CHANGES.has(event.type)) {
		const info = sessionID ? await readSession(sessionID) : undefined;
		return info ? [at("session.updated", { info: toV1Session(info) })] : [];
	}
	if (!sessionID && event.type !== "form.created") return [];

	switch (event.type) {
		case "session.deleted":
			return [at("session.deleted", { sessionID })];
		case "session.execution.started":
			return [at("session.status", { sessionID, status: { type: "busy" } })];
		case "session.retry.scheduled":
			return [at("session.status", { sessionID, status: { type: "retry" } })];
		case "session.status":
			return [at("session.status", { ...data })];
		case "session.idle":
		case "session.execution.succeeded":
		case "session.execution.interrupted":
			return [{ ...idle(sessionID!), ...(directory ? { directory } : {}) }];
		case "session.execution.failed": {
			const error = (data.error ?? {}) as { type?: unknown; message?: unknown };
			return [
				at("session.error", {
					sessionID,
					error: { name: error.type, data: { message: error.message } },
				}),
				{ ...idle(sessionID!), ...(directory ? { directory } : {}) },
			];
		}
		case "permission.asked":
		case "permission.replied":
			return [at(event.type, { ...data })];
		case "form.created": {
			const form = (data.form ?? {}) as { id?: unknown; sessionID?: unknown };
			return [at("question.asked", { id: form.id, sessionID: form.sessionID })];
		}
		case "form.replied":
			return [at("question.replied", { sessionID, requestID: data.id })];
		case "form.cancelled":
			return [at("question.rejected", { sessionID, requestID: data.id })];
		case "session.inbox.enqueued": {
			const item = (data.item ?? {}) as { type?: unknown; payload?: { text?: unknown } };
			if (item.type !== "user") return [];
			const messageID = data.inboxID;
			return [
				at("message.updated", { info: { id: messageID, sessionID, role: "user" } }),
				at("message.part.updated", {
					part: { messageID, type: "text", text: item.payload?.text ?? "" },
				}),
			];
		}
		default:
			return [];
	}
}
