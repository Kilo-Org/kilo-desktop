import { createKiloClient } from "@kilocode/sdk/v2/client";

import type { GitCapabilities } from "@kilo-desktop/plugin-git/contracts";
import type { MainSdk } from "@kilo-desktop/feature-sdk/main";

import type { KiloGlobalConnection } from "../../contracts/chat/schemas.js";
import { listAllSessionPages } from "../../contracts/chat/session-list-pages.js";

/**
 * Agent Manager session links for Desktop worktrees.
 *
 * The VS Code extension's Agent Manager adopts every worktree under
 * `.kilo/worktrees/`, Desktop's included, but only shows a session in one
 * when the worktree's git admin directory holds its metadata file. New
 * worktree sessions get that file when they are created (`chat.linkWorktreeSession`).
 * Worktrees from before that existed are backfilled here.
 *
 * The backfill runs once per process, on the first `ready` from the Kilo
 * server. It waits for `ready` instead of calling `getConnection` at boot
 * because that call would spawn the server early (kilo-server spawns lazily).
 * A failed run resets so the next `ready` retries; a completed run is final.
 * Re-running is harmless anyway: the git plugin only creates the file and never
 * overwrites one, so Agent Manager's own links and earlier runs are untouched.
 *
 * Each worktree gets one session. Desktop gives every worktree its own
 * session, so this picks the most recently updated live session, falling back
 * to an archived one. An archived link still beats an empty entry, because
 * Agent Manager can then open the conversation and delete the worktree.
 */

const KILO_DESKTOP_METADATA_KEY = "kilo-desktop";
const PRE_RENAME_METADATA_KEY = "anaconda";

type KiloServerCapabilities = {
	connectionService: { getConnection(): Promise<KiloGlobalConnection> };
};

type GitService = GitCapabilities["gitService"];

export type LinkableSession = {
	id: string;
	directory?: string | undefined;
	parentID?: string | undefined;
	time: { updated: number; archived?: number | null | undefined };
	metadata?: unknown;
};

export type WorktreeSessionLink = { directory: string; sessionId: string };

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function hasWorktreeStamp(metadata: unknown): boolean {
	const record = asRecord(metadata);
	const owned =
		asRecord(record?.[KILO_DESKTOP_METADATA_KEY]) ?? asRecord(record?.[PRE_RENAME_METADATA_KEY]);
	const branch = asRecord(owned?.worktree)?.branch;
	return typeof branch === "string" && branch.length > 0;
}

const isArchived = (session: LinkableSession) => typeof session.time.archived === "number";

function outranks(candidate: LinkableSession, current: LinkableSession): boolean {
	if (isArchived(candidate) !== isArchived(current)) return !isArchived(candidate);
	return candidate.time.updated > current.time.updated;
}

/** One session per Desktop worktree directory. */
export function selectWorktreeSessionLinks(
	sessions: readonly LinkableSession[],
): WorktreeSessionLink[] {
	const byDirectory = new Map<string, LinkableSession>();
	for (const session of sessions) {
		if (session.parentID || !session.directory || !hasWorktreeStamp(session.metadata)) continue;
		const current = byDirectory.get(session.directory);
		if (!current || outranks(session, current)) byDirectory.set(session.directory, session);
	}
	return [...byDirectory].map(([directory, session]) => ({ directory, sessionId: session.id }));
}

/** Never throws: a failed link only costs the Agent Manager entry its session. */
export async function linkAgentManagerSession(
	mainSdk: Pick<MainSdk, "logger">,
	gitService: GitService,
	input: { path: string; sessionId: string; baseRef?: string },
): Promise<boolean> {
	try {
		return await gitService.linkAgentManagerSession(input);
	} catch (error) {
		mainSdk.logger.warn("Could not link a worktree session for the VS Code Agent Manager.", {
			error: error instanceof Error ? error.message : String(error),
			sessionId: input.sessionId,
		});
		return false;
	}
}

export function listKiloSessionsForLinking(
	connection: KiloGlobalConnection,
): Promise<LinkableSession[]> {
	const authorization = Buffer.from(`${connection.username}:${connection.password}`).toString(
		"base64",
	);
	const client = createKiloClient({
		baseUrl: connection.baseUrl,
		headers: { Authorization: `Basic ${authorization}` },
	});
	return listAllSessionPages(async (query) => {
		const response = await client.experimental.session.list(query, { throwOnError: true });
		return response.data ?? [];
	});
}

export async function backfillAgentManagerSessionLinks(
	mainSdk: Pick<MainSdk, "logger" | "plugins">,
	listSessions: (connection: KiloGlobalConnection) => Promise<readonly LinkableSession[]>,
): Promise<void> {
	const gitService = mainSdk.plugins.get<GitCapabilities>("git")?.gitService;
	if (!gitService) return;
	const connectionService =
		mainSdk.plugins.get<KiloServerCapabilities>("kilo-server")?.connectionService;
	if (!connectionService) throw new Error("Kilo Server is unavailable.");

	const sessions = await listSessions(await connectionService.getConnection());
	let linked = 0;
	for (const link of selectWorktreeSessionLinks(sessions)) {
		const wrote = await linkAgentManagerSession(mainSdk, gitService, {
			path: link.directory,
			sessionId: link.sessionId,
		});
		if (wrote) linked += 1;
	}
	if (linked > 0) {
		mainSdk.logger.info(`Linked ${linked} worktree session(s) for the VS Code Agent Manager.`);
	}
}

function isReadyStatus(status: unknown): boolean {
	return asRecord(status)?.status === "ready";
}

export function startAgentManagerLinkBackfill(
	mainSdk: Pick<MainSdk, "logger" | "plugins" | "events">,
	listSessions: (
		connection: KiloGlobalConnection,
	) => Promise<readonly LinkableSession[]> = listKiloSessionsForLinking,
): () => void {
	let phase: "pending" | "running" | "done" = "pending";
	return mainSdk.events.on("kilo-server.server-status-changed", (status) => {
		if (phase !== "pending" || !isReadyStatus(status)) return;
		phase = "running";
		void backfillAgentManagerSessionLinks(mainSdk, listSessions).then(
			() => {
				phase = "done";
			},
			(error: unknown) => {
				phase = "pending";
				mainSdk.logger.warn("Could not backfill worktree session links for the Agent Manager.", {
					error: error instanceof Error ? error.message : String(error),
				});
			},
		);
	});
}
