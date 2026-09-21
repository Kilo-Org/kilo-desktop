import { toast } from "@kilo-desktop/ui/components/sonner";
import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { KiloGlobalConnection } from "../../contracts/chat/schemas.js";
import { createKiloDirectoryClient } from "./runtime/create-kilo-runtime-client.js";
import {
	asRecord,
	buildKiloDesktopSessionMetadata,
	readKiloDesktopSessionMetadata,
	type SessionActivity,
} from "./session-activity/session-activity-logic.js";
import type { SessionActivityStore } from "./session-activity/session-activity-store.js";

/**
 * Maximum prompts considered for automatic naming before disarming
 * (kilocode's `BranchNamingController`).
 */
const MAX_PROMPTS = 4;

export type RenameWorktreeBranch = (input: {
	directory: string;
	currentBranch: string;
	requestedBranch: string;
}) => Promise<{ branch: string } | null>;

export interface WorktreeBranchNamerDeps {
	/** Live connection getter for directory-scoped Kilo clients. */
	getConnection: () => Promise<KiloGlobalConnection>;
	/** Session-activity store: eligibility, busy state, directories. */
	sessionActivity: SessionActivityStore;
	/** kilo-ui contract invoke running the git plugin's guarded rename. */
	renameWorktreeBranch: RenameWorktreeBranch;
	/**
	 * Check whether the worktree session at `directory` has actual work
	 * (uncommitted changes or commits ahead of `baseBranch`). Gates the
	 * idle-path generation — a session with no work stays armed but skips
	 * generation until work is detected. Injectable for tests.
	 */
	hasWorktreeWork?: (input: { directory: string; baseBranch?: string }) => Promise<boolean>;
	/**
	 * Directory client factory. Injectable for tests; defaults to the live
	 * Kilo directory client over the existing kilo HTTP path.
	 */
	createDirectoryClient?: (directory: string) => Promise<KiloClient>;
	/** Success toast; injectable so tests assert it without the toaster. */
	notify?: (message: string) => void;
	/** Diagnostic sink for skipped generations (never asserted in tests). */
	log?: (message: string) => void;
}

interface EligibleSession {
	readonly directory: string;
	readonly currentBranch: string;
}

/**
 * Ports kilocode's `BranchNamingController`: once a worktree-backed session
 * shows conversational intent, its `kilo/<friendly-words>` branch is renamed
 * to a semantic, LLM-generated name (keeping the `kilo/` prefix).
 *
 * In-memory ownership model (all bookkeeping lives here, none persists):
 * - Armed per session: prompt 1 arms, prompts 2–MAX_PROMPTS dispatch a
 *   generation, after that disarm. The single-detailed-prompt case is
 *   covered by one dispatch on the first idle transition with exactly one
 *   prompt — the endpoint returns `null` for greetings/vague prompts, which
 *   keeps the session armed.
 * - Eligibility is re-read from the activity store at every step: the
 *   session must carry a `kilo/`-prefixed `worktreeBranch` and be the only
 *   known session in its directory (multi-session disarms, per kilocode).
 * - Busy sessions stash a generated name and apply it on the next idle
 *   transition (activity-store subscription).
 * - One in-flight generation per session (abort-tracked); `dispose()`
 *   unsubscribes and aborts, and is called from the owning effect cleanup
 *   in `ChatFeatureProvider`.
 *
 * Failures are outcomes, not errors: generation/rename/re-stamp failures are
 * logged and the session stays armed within the prompt cap; the chat is
 * never blocked.
 */
export function createWorktreeBranchNamer(deps: WorktreeBranchNamerDeps): {
	prompt: (input: { sessionID: string; text: string }) => void;
	dispose: () => void;
} {
	const promptCounts = new Map<string, number>();
	const requests = new Map<string, AbortController>();
	const pending = new Map<string, string>();
	const idleAttempted = new Set<string>();
	let disposed = false;

	const log = (message: string) => {
		deps.log?.(message);
	};

	const directoryClient =
		deps.createDirectoryClient ??
		(async (directory: string) => createKiloDirectoryClient(await deps.getConnection(), directory));

	const sessionOf = (sessionID: string): SessionActivity | undefined =>
		deps.sessionActivity.getState().sessions[sessionID];

	const isBusy = (sessionID: string): boolean =>
		sessionOf(sessionID)?.status === "busy" || sessionOf(sessionID)?.status === "retry";

	/** Eligibility per the rename path: kilo/ worktree branch, sole session in its directory. */
	const eligible = (sessionID: string): EligibleSession | null => {
		const activity = sessionOf(sessionID);
		const branch = activity?.worktreeBranch;
		if (!branch?.startsWith("kilo/") || !activity?.directory) return null;
		const soleInDirectory = Object.values(deps.sessionActivity.getState().sessions).every(
			(other) => other === activity || other.directory !== activity.directory,
		);
		if (!soleInDirectory) return null;
		return { directory: activity.directory, currentBranch: branch };
	};

	const forget = (sessionID: string): void => {
		promptCounts.delete(sessionID);
		pending.delete(sessionID);
		idleAttempted.delete(sessionID);
		const request = requests.get(sessionID);
		if (request) {
			request.abort();
			requests.delete(sessionID);
		}
	};

	/** Re-stamp the session with the renamed branch, preserving the rest of the stamp. */
	const restamp = async (sessionID: string, directory: string, branch: string): Promise<void> => {
		const client = await directoryClient(directory);
		const { data: session } = await client.session.get({ sessionID }, { throwOnError: true });
		const existing = readKiloDesktopSessionMetadata(session?.metadata);
		const metadata = buildKiloDesktopSessionMetadata({
			...(existing?.workspaceId ? { workspaceId: existing.workspaceId } : {}),
			...(existing?.workspaceFolders ? { workspaceFolders: existing.workspaceFolders } : {}),
			worktreeBranch: branch,
		});
		// session.update replaces the metadata object wholesale (the same API
		// contract `unscopeKiloDesktopMetadata` spreads for), so preserve
		// unrelated top-level keys — including a legacy `anaconda` ownership
		// stamp (readers prefer `kilo-desktop`; keeping it is data-loss-free).
		const existingRecord = asRecord(session?.metadata) ?? {};
		await client.session.update(
			{ sessionID, metadata: { ...existingRecord, ...metadata.metadata } },
			{ throwOnError: true },
		);
		// Patch locally too: the SSE `session.updated` info may not carry
		// metadata, and the store should reflect the rename immediately.
		deps.sessionActivity.getState().hydrateSessions([{ id: sessionID, worktreeBranch: branch }]);
	};

	const applyRename = async (sessionID: string, generated: string): Promise<void> => {
		if (disposed) return;
		// Eligibility is re-read here, not reused from dispatch: the generation
		// ran async and the session may since have gained a directory sibling or
		// lost its worktree stamp. kilocode's BranchNamingController re-verifies
		// at apply time the same way — the snapshot is never reused.
		const info = eligible(sessionID);
		if (!info) {
			forget(sessionID);
			return;
		}
		try {
			const renamed = await deps.renameWorktreeBranch({
				directory: info.directory,
				currentBranch: info.currentBranch,
				requestedBranch: generated,
			});
			// Guard declined — stay armed; a later prompt can retry.
			if (!renamed) return;
			await restamp(sessionID, info.directory, renamed.branch);
			(deps.notify ?? ((message: string) => toast.success(message)))(
				`Branch renamed to ${renamed.branch}`,
			);
			forget(sessionID);
		} catch (error) {
			log(`Skipped automatic branch naming: ${error}`);
		}
	};

	const queueRename = (sessionID: string, generated: string): void => {
		if (isBusy(sessionID)) {
			pending.set(sessionID, generated);
			return;
		}
		void applyRename(sessionID, generated);
	};

	const generate = async (
		sessionID: string,
		info: EligibleSession,
		text: string,
	): Promise<void> => {
		const request = new AbortController();
		requests.set(sessionID, request);
		try {
			const client = await directoryClient(info.directory);
			const { data } = await client.branchName.generate(
				{ sessionID, directory: info.directory, prompt: text },
				{ throwOnError: true, signal: request.signal },
			);
			if (!data?.branch || request.signal.aborted) return;
			queueRename(sessionID, data.branch);
		} catch (error) {
			if (!request.signal.aborted) log(`Skipped automatic branch naming: ${error}`);
		} finally {
			if (requests.get(sessionID) === request) requests.delete(sessionID);
		}
	};

	const onStoreChange = (): void => {
		if (disposed) return;
		// Apply names held while busy once the session goes idle.
		for (const [sessionID, generated] of [...pending]) {
			if (isBusy(sessionID)) continue;
			pending.delete(sessionID);
			void applyRename(sessionID, generated);
		}
		// The single-detailed-prompt case: one dispatch on the first idle
		// transition with exactly one prompt, gated on actual work.
		for (const [sessionID, count] of [...promptCounts]) {
			if (
				count !== 1 ||
				isBusy(sessionID) ||
				idleAttempted.has(sessionID) ||
				requests.has(sessionID)
			) {
				continue;
			}
			idleAttempted.add(sessionID);
			const info = eligible(sessionID);
			if (!info) continue;
			if (deps.hasWorktreeWork) {
				void deps.hasWorktreeWork({ directory: info.directory }).then(
					(hasWork) => {
						if (hasWork) void generate(sessionID, info, "");
						else {
							// No work yet — un-mark attempted so the next idle
							// transition can retry.
							idleAttempted.delete(sessionID);
						}
					},
					() => {
						// hasWorktreeWork failure treated as "no work" — stay armed.
						idleAttempted.delete(sessionID);
					},
				);
			} else {
				void generate(sessionID, info, "");
			}
		}
	};

	const unsubscribe = deps.sessionActivity.subscribe(onStoreChange);

	return {
		/** Called for every outgoing user message. Arms, counts, dispatches, disarms. */
		prompt({ sessionID, text }): void {
			if (disposed) return;
			const info = eligible(sessionID);
			if (!info) {
				forget(sessionID);
				return;
			}
			const count = (promptCounts.get(sessionID) ?? 0) + 1;
			promptCounts.set(sessionID, count);
			idleAttempted.delete(sessionID);
			if (count > MAX_PROMPTS) {
				forget(sessionID);
				return;
			}
			// Prompt 1 arms; a generation or a held rename occupies the slot.
			if (count < 2 || requests.has(sessionID) || pending.has(sessionID)) return;
			void generate(sessionID, info, text);
		},

		dispose(): void {
			disposed = true;
			unsubscribe();
			for (const request of requests.values()) request.abort();
			requests.clear();
			pending.clear();
			promptCounts.clear();
		},
	};
}
