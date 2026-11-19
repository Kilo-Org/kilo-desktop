import type { PluginSdk } from "@kilo-desktop/kernel";

import { DEFAULT_WORK_SESSION_TITLE, type WorkSession } from "../../contracts/model";
import {
	originImportMode,
	recoverable,
	reportOriginImportFailure,
	type SqliteLoader,
} from "../origin-database";
import { readOriginSessions, type OriginSession } from "./import-origin";
import type { WorkSessionRegistry } from "./registry";

/**
 * The archive change time of a work session no one has archived or
 * restored, so any archived chat archives it. Origin kept archives on its
 * chats only, and stamped sessions it adopted chats into with the adoption
 * time, often after the chat was archived; dating the choice to then would
 * keep it live.
 */
export const ARCHIVE_NEVER_CHOSEN = 0;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A release imported origin's sessions with their creation time as their
 * archive change, so chats archived before origin adopted them came back
 * live. Each work session still live with that stamp (the person hasn't
 * archived or restored it since) is reopened to its chats' archives, once.
 * Work sessions this app created carry the same stamp, harmlessly: their
 * chats' archives are later than it, so already applied.
 */
export function reopenOriginArchives(sdk: PluginSdk, registry: WorkSessionRegistry): void {
	const { workSessions, importedFromOrigin, originArchivesReopened } = registry.persisted();
	if (originArchivesReopened) return;
	try {
		registry.save(
			importedFromOrigin
				? workSessions.map((workSession) =>
						!workSession.archived && workSession.archiveChangedAt === workSession.createdAt
							? { ...workSession, archiveChangedAt: ARCHIVE_NEVER_CHOSEN }
							: workSession,
					)
				: workSessions,
			{ originArchivesReopened: true },
		);
	} catch (error) {
		sdk.logger.warn(
			`Could not reopen origin's archived sessions; will try again next launch: ${errorText(error)}`,
		);
	}
}

/** What a person (or a chat, for one adopted from it) set on a work session, carried to the one replacing it. */
function personalChoices(workSession: WorkSession): Partial<WorkSession> {
	return {
		title: workSession.title,
		titleSource: workSession.titleSource,
		pinned: workSession.pinned,
		archived: workSession.archived,
		archiveChangedAt: workSession.archiveChangedAt,
		workspaceId: workSession.workspaceId,
		branch: workSession.branch,
		directory: workSession.directory,
		updatedAt: workSession.updatedAt,
	};
}

/**
 * Imports origin's work sessions once; settles true once they are imported
 * (or there are none), false when the read failed and will be retried next
 * launch. An install an earlier release marked imported without reading
 * origin gets them now, unless some are already here (`originImportMode`).
 */
export async function importOriginWorkSessions(
	sdk: PluginSdk,
	registry: WorkSessionRegistry,
	file: string | undefined,
	loadDriver?: SqliteLoader,
): Promise<boolean> {
	const mode = originImportMode(registry.persisted());
	if (!file || mode === "done") return true;
	try {
		const origin = await readOriginSessions(file, loadDriver);
		const merging =
			mode === "import" ||
			recoverable(
				origin.map((session) => session.id),
				registry.list().map((workSession) => workSession.id),
			);
		if (merging) mergeOriginSessions(registry, origin);
		else registry.save(registry.list(), { importedFromOrigin: true, originImportVerified: true });
		return true;
	} catch (error) {
		reportOriginImportFailure(sdk, "sessions", file, error);
		return false;
	}
}

/**
 * Adds origin's work sessions with their chats. A launch whose import failed
 * adopted origin's chats into work sessions of their own; such a work session
 * (every chat it holds belongs to one origin session) is folded into
 * origin's, keeping what the person changed on it. A chat held by any other
 * work session stays there and leaves origin's. Each added work session is
 * announced as created, like one adopted from a chat, so kilo.chat gives it
 * its agent pane (origin showed every session's chat without saving a pane).
 */
function mergeOriginSessions(
	registry: WorkSessionRegistry,
	origin: readonly OriginSession[],
): void {
	const current = registry.list();
	const existing = new Set(current.map((workSession) => workSession.id));
	const fresh = origin.filter((session) => !existing.has(session.id));
	const originOf = new Map<string, string>();
	for (const session of fresh) {
		for (const chatId of session.chatIds) originOf.set(chatId, session.id);
	}
	const adopted = current.filter((workSession) => {
		const target = workSession.chatIds[0] && originOf.get(workSession.chatIds[0]);
		return target && workSession.chatIds.every((chatId) => originOf.get(chatId) === target);
	});
	const adoptedSet = new Set(adopted);
	const kept = current.filter((workSession) => !adoptedSet.has(workSession));
	const held = new Set(kept.flatMap((workSession) => workSession.chatIds));
	const added = fresh.flatMap((session): WorkSession[] => {
		const chatIds = session.chatIds.filter((chatId) => !held.has(chatId));
		if (session.chatIds.length > 0 && chatIds.length === 0) return [];
		const ownChatIds = new Set(chatIds);
		const folded = adopted.filter((candidate) => ownChatIds.has(candidate.chatIds[0]!));
		// The work session holding origin's first chat leads, as that chat leads the title.
		const lead = folded.find((candidate) => candidate.chatIds.includes(chatIds[0]!));
		return [
			{
				id: session.id,
				title: DEFAULT_WORK_SESSION_TITLE,
				titleSource: "default",
				pinned: false,
				archived: false,
				archiveChangedAt: ARCHIVE_NEVER_CHOSEN,
				workspaceId: null,
				branch: null,
				directory: null,
				createdAt: session.createdAt,
				updatedAt: session.createdAt,
				...(lead ? personalChoices(lead) : {}),
				...(folded.some((candidate) => candidate.pinned) ? { pinned: true } : {}),
				chatIds,
			},
		];
	});
	registry.save([...kept, ...added], { importedFromOrigin: true, originImportVerified: true });
	for (const workSession of adopted) registry.announceDeleted(workSession);
	for (const workSession of added) registry.announceCreated(workSession);
}
