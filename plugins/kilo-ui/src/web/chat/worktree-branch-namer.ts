import { toast } from "@kilo-desktop/ui/components/sonner";
import type { KiloClient } from "@kilocode/sdk/v2/client";

import type { KiloGlobalConnection } from "../../contracts/chat/schemas.js";
import { createKiloDirectoryClient } from "./runtime/create-kilo-runtime-client.js";
import {
	asRecord,
	buildKiloDesktopSessionMetadata,
	readKiloDesktopSessionMetadata,
	type SessionActivity,
} from "../session/activity/session-activity-logic.js";
import type { SessionActivityStore } from "../session/activity/session-activity-store.js";

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

export interface BranchNamerPrompt {
	sessionID: string;
	text: string;
	providerID?: string;
	modelID?: string;
}

export interface WorktreeBranchNamerDeps {
	/** Live connection getter for directory-scoped Kilo clients. */
	getConnection: () => Promise<KiloGlobalConnection>;
	/** Session-activity store: eligibility, busy state, directories. */
	sessionActivity: SessionActivityStore;
	/** kilo-ui contract invoke running the git plugin's guarded rename. */
	renameWorktreeBranch: RenameWorktreeBranch;
	/**
	 * Check whether the worktree session at `directory` has actual work
	 * (uncommitted changes or commits ahead of the worktree's base ref).
	 * Gates the idle-path generation — a session with no work stays armed
	 * but skips generation until work is detected. Injectable for tests.
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

interface ArmedSession {
	promptCount: number;
	/** The single-prompt idle path already ran for the current prompt count. */
	idleAttempted: boolean;
	/** Last observed busy state, so the idle path fires on transitions only. */
	wasBusy: boolean;
	/** A generated name held while the session was busy. */
	pending?: string;
	/** The latest prompt's model, reused by the idle path. */
	model?: { providerID?: string; modelID?: string };
	/**
	 * The ref the worktree was branched from (e.g. `origin/main`), so the
	 * idle-path work probe compares commits ahead of the worktree's real
	 * base instead of the repository's default branch. Absent when the
	 * worktree was cut from HEAD — the probe then only counts uncommitted
	 * changes.
	 */
	baseRef?: string;
}

/**
 * Ports kilocode's `BranchNamingController`: once a worktree-backed session
 * shows conversational intent, its `kilo/<friendly-words>` branch is renamed
 * to a semantic, LLM-generated name (keeping the `kilo/` prefix).
 *
 * Arming is explicit and one-shot (kilocode's `autoNameSessionId`): only a
 * session `arm`ed at creation is ever considered — and callers arm only when
 * that session's preparation *created* its worktree, never for a reused
 * existing worktree (kilocode's `branchOwned` gate) — and disarming — a
 * successful git rename, the prompt cap, or lost eligibility — is terminal.
 * The `kilo/` prefix cannot serve as the arming signal because the rename
 * keeps it. Arming is in-memory, so a reload fails closed: sessions from a
 * previous renderer lifetime are never renamed. `arm` optionally takes the
 * ref the worktree was branched from (`baseRef`, e.g. `origin/main`);
 * stored per session and threaded into the idle-path work probe so it
 * compares against the worktree's real base instead of the repository's
 * default branch — the two differ whenever the base was fetched fresh or
 * the user picked a non-default base. Absent `baseRef` means the worktree
 * was cut from HEAD, so the probe only counts uncommitted changes.
 *
 * Per armed session: prompt 1 only counts, prompts 2–MAX_PROMPTS dispatch a
 * generation, after that disarm. A single detailed prompt is covered by one
 * dispatch on the first busy → idle transition with exactly one prompt,
 * gated on actual work — the endpoint returns `null` for greetings/vague
 * prompts, which keeps the session armed.
 *
 * Eligibility is re-read from the activity store at every step: the session
 * must carry a `kilo/`-prefixed `worktreeBranch` and be the only root
 * session in its directory (subagent children share it and do not count;
 * a second root disarms, per kilocode).
 *
 * One request slot per session covers the work probe, generation, and
 * rename, so no two can overlap. Busy sessions stash a generated name and
 * apply it once idle. `dispose()` unsubscribes and aborts, and is called
 * from the owning effect cleanup in `ChatFeatureProvider`.
 *
 * Failures are outcomes, not errors: generation/rename/re-stamp failures are
 * logged and the chat is never blocked.
 */
export function createWorktreeBranchNamer(deps: WorktreeBranchNamerDeps): {
	arm: (sessionID: string, options?: { baseRef?: string }) => void;
	prompt: (input: BranchNamerPrompt) => void;
	dispose: () => void;
} {
	const armed = new Map<string, ArmedSession>();
	const requests = new Map<string, AbortController>();
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

	/** Eligibility per the rename path: kilo/ worktree branch, sole root session in its directory. */
	const eligible = (sessionID: string): EligibleSession | null => {
		const activity = sessionOf(sessionID);
		const branch = activity?.worktreeBranch;
		if (!branch?.startsWith("kilo/") || !activity?.directory) return null;
		const soleInDirectory = Object.values(deps.sessionActivity.getState().sessions).every(
			(other) =>
				other === activity ||
				other.parentId !== undefined ||
				other.directory !== activity.directory,
		);
		if (!soleInDirectory) return null;
		return { directory: activity.directory, currentBranch: branch };
	};

	const disarm = (sessionID: string): void => {
		armed.delete(sessionID);
		const request = requests.get(sessionID);
		if (request) {
			request.abort();
			requests.delete(sessionID);
		}
	};

	/** Occupy the session's request slot for the duration of `run`. */
	const withSlot = async (
		sessionID: string,
		run: (signal: AbortSignal) => Promise<void>,
	): Promise<void> => {
		const request = new AbortController();
		requests.set(sessionID, request);
		try {
			await run(request.signal);
		} catch (error) {
			if (!request.signal.aborted) log(`Skipped automatic branch naming: ${error}`);
		} finally {
			if (requests.get(sessionID) === request) requests.delete(sessionID);
		}
	};

	/** Re-stamp the session with the renamed branch, preserving the rest of the stamp. */
	const restamp = async (sessionID: string, directory: string, branch: string): Promise<void> => {
		// Patch locally first: git is the truth, and the SSE `session.updated`
		// info may not carry metadata.
		deps.sessionActivity.getState().hydrateSessions([{ id: sessionID, worktreeBranch: branch }]);
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
	};

	const applyRename = async (sessionID: string, generated: string): Promise<void> => {
		if (disposed || !armed.has(sessionID)) return;
		// Eligibility is re-read here, not reused from dispatch: the generation
		// ran async and the session may since have gained a directory sibling or
		// lost its worktree stamp (kilocode re-verifies at apply time too).
		const info = eligible(sessionID);
		if (!info) {
			disarm(sessionID);
			return;
		}
		const renamed = await deps.renameWorktreeBranch({
			directory: info.directory,
			currentBranch: info.currentBranch,
			requestedBranch: generated,
		});
		// Guard declined — stay armed; a later prompt can retry.
		if (!renamed) return;
		// Disarm on git's success, before the re-stamp: a failed stamp must
		// never leave the session renameable a second time.
		disarm(sessionID);
		(deps.notify ?? ((message: string) => toast.success(message)))(
			`Branch renamed to ${renamed.branch}`,
		);
		await restamp(sessionID, info.directory, renamed.branch).catch((error: unknown) => {
			log(`Renamed branch to ${renamed.branch} but could not re-stamp the session: ${error}`);
		});
	};

	/** Generate a name inside the caller's slot, then apply it or hold it while busy. */
	const generate = async (
		sessionID: string,
		info: EligibleSession,
		text: string,
		signal: AbortSignal,
	): Promise<void> => {
		const model = armed.get(sessionID)?.model;
		const client = await directoryClient(info.directory);
		const { data } = await client.branchName.generate(
			{
				sessionID,
				directory: info.directory,
				prompt: text,
				...(model?.providerID ? { providerID: model.providerID } : {}),
				...(model?.modelID ? { modelID: model.modelID } : {}),
			},
			{ throwOnError: true, signal },
		);
		if (!data?.branch || signal.aborted) return;
		const state = armed.get(sessionID);
		if (!state) return;
		if (isBusy(sessionID)) {
			state.pending = data.branch;
			return;
		}
		// Applied inside the slot so a fast next prompt cannot dispatch a
		// redundant generation while the rename settles.
		await applyRename(sessionID, data.branch);
	};

	const generateOnIdle = (sessionID: string, state: ArmedSession): void => {
		const info = eligible(sessionID);
		if (!info) {
			disarm(sessionID);
			return;
		}
		void withSlot(sessionID, async (signal) => {
			if (deps.hasWorktreeWork) {
				const hasWork = await deps
					.hasWorktreeWork({
						directory: info.directory,
						...(state.baseRef ? { baseBranch: state.baseRef } : {}),
					})
					.catch(() => false);
				if (signal.aborted || !armed.has(sessionID)) return;
				if (!hasWork) {
					// No work yet — the next idle transition may retry.
					state.idleAttempted = false;
					return;
				}
			}
			await generate(sessionID, info, "", signal);
		});
	};

	const onStoreChange = (): void => {
		if (disposed) return;
		for (const [sessionID, state] of [...armed]) {
			const busy = isBusy(sessionID);
			const becameIdle = state.wasBusy && !busy;
			state.wasBusy = busy;
			if (busy) continue;
			if (state.pending !== undefined) {
				const generated = state.pending;
				delete state.pending;
				void withSlot(sessionID, () => applyRename(sessionID, generated));
				continue;
			}
			if (
				becameIdle &&
				state.promptCount === 1 &&
				!state.idleAttempted &&
				!requests.has(sessionID)
			) {
				state.idleAttempted = true;
				generateOnIdle(sessionID, state);
			}
		}
	};

	const unsubscribe = deps.sessionActivity.subscribe(onStoreChange);

	return {
		/** Arm a freshly created session for one automatic rename. */
		arm(sessionID, options): void {
			if (disposed || armed.has(sessionID)) return;
			armed.set(sessionID, {
				promptCount: 0,
				idleAttempted: false,
				wasBusy: isBusy(sessionID),
				...(options?.baseRef ? { baseRef: options.baseRef } : {}),
			});
		},

		/** Called for every outgoing user message. Counts, dispatches, disarms. */
		prompt({ sessionID, text, providerID, modelID }): void {
			if (disposed) return;
			const state = armed.get(sessionID);
			if (!state) return;
			const info = eligible(sessionID);
			if (!info) {
				disarm(sessionID);
				return;
			}
			state.promptCount += 1;
			state.idleAttempted = false;
			state.model = {
				...(providerID ? { providerID } : {}),
				...(modelID ? { modelID } : {}),
			};
			if (state.promptCount > MAX_PROMPTS) {
				disarm(sessionID);
				return;
			}
			// Prompt 1 only counts; an in-flight request or a held name occupies the slot.
			if (state.promptCount < 2 || requests.has(sessionID) || state.pending !== undefined) {
				return;
			}
			void withSlot(sessionID, (signal) => generate(sessionID, info, text, signal));
		},

		dispose(): void {
			disposed = true;
			unsubscribe();
			for (const request of requests.values()) request.abort();
			requests.clear();
			armed.clear();
		},
	};
}
