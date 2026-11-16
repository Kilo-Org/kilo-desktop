import type { ModelRef } from "@kilo-desktop/plugin-core/contracts";

/** Prompts considered for automatic naming before disarming (kilocode's `BranchNamingController`). */
export const MAX_PROMPTS = 4;

export type BranchNamerModel = ModelRef;

/** Where an eligible chat's worktree is and what its branch is called now. */
export interface NamerTarget {
	readonly workSessionId: string;
	readonly directory: string;
	readonly currentBranch: string;
}

/** What survives a restart for an armed chat. */
export interface ArmedProgress {
	readonly promptCount: number;
	/** The single-prompt idle path already ran for the current prompt count. */
	readonly idleAttempted: boolean;
	/** The ref the worktree was cut from, for the idle work probe; absent when cut from HEAD. */
	readonly baseRef?: string;
	/** The latest prompt's model, reused by the idle path. */
	readonly model?: BranchNamerModel;
}

export type ArmedChats = Readonly<Record<string, ArmedProgress>>;

export interface BranchNamerDeps {
	/** The chat's worktree when it may still be renamed, else null (re-read at every step). */
	target(chatId: string): NamerTarget | null;
	isBusy(chatId: string): boolean;
	generate(input: {
		chatId: string;
		prompt: string;
		model?: BranchNamerModel;
	}): Promise<string | null>;
	rename(input: {
		directory: string;
		currentBranch: string;
		requestedBranch: string;
	}): Promise<{ branch: string } | null>;
	hasCopyWork(input: { directory: string; baseBranch?: string }): Promise<boolean>;
	/** Records the new branch on the work session (and so its chats); failures are the caller's to log. */
	renamed(input: { chatId: string; workSessionId: string; branch: string }): Promise<void>;
	readonly progress: {
		load(): ArmedChats;
		save(armed: ArmedChats): void;
	};
	log?(message: string): void;
}

export interface BranchNamer {
	/** Arms a chat whose session created its worktree, for one automatic rename. */
	arm(chatId: string, options?: { baseRef?: string | undefined }): void;
	/** Every message sent to a chat: counts, dispatches, disarms. */
	prompt(input: { chatId: string; text: string; model?: BranchNamerModel | undefined }): void;
	turnEnded(chatId: string): void;
	/** Drops a chat for good (its session is gone). */
	forget(chatId: string): void;
	dispose(): void;
}

/**
 * Ports kilocode's `BranchNamingController` (origin's renderer namer): once a
 * worktree chat shows conversational intent, its `kilo/<friendly-words>`
 * branch is renamed to an LLM-generated one (the rename keeps `kilo/`).
 *
 * Arming is explicit and one-shot: only a chat `arm`ed when it joined the
 * session that created its worktree is ever considered, and disarming — a
 * successful git rename, the prompt cap, lost eligibility — is terminal. The
 * `kilo/` prefix can't be the signal because the rename keeps it. Unlike
 * origin, which armed in renderer memory and so failed closed on reload,
 * progress is saved (`progress`) on every change so a restart neither
 * forgets an armed chat nor renames one twice; a name held while busy is not
 * saved (the next prompt asks again).
 *
 * Per armed chat: prompt 1 only counts, prompts 2–MAX_PROMPTS dispatch a
 * generation, after that disarm. A single detailed prompt is covered by one
 * dispatch when its turn ends with exactly one prompt, gated on actual work
 * in the worktree; the server answers null for greetings or vague prompts,
 * which keeps the chat armed.
 *
 * One request slot per chat covers the work probe, generation and rename, so
 * no two overlap. A name generated while the chat is busy is held and applied
 * when its turn ends. Failures are outcomes, never errors: the chat is never
 * blocked.
 */
export function createBranchNamer(deps: BranchNamerDeps): BranchNamer {
	const armed = new Map<string, ArmedProgress>(Object.entries(deps.progress.load()));
	const requests = new Map<string, AbortController>();
	const pending = new Map<string, string>();
	let disposed = false;

	const log = (message: string) => deps.log?.(message);
	const save = () => deps.progress.save(Object.fromEntries(armed));

	const update = (chatId: string, patch: Partial<ArmedProgress>) => {
		const state = armed.get(chatId);
		if (!state) return;
		armed.set(chatId, { ...state, ...patch });
		save();
	};

	const disarm = (chatId: string): void => {
		pending.delete(chatId);
		requests.get(chatId)?.abort();
		requests.delete(chatId);
		if (armed.delete(chatId)) save();
	};

	const withSlot = async (
		chatId: string,
		run: (signal: AbortSignal) => Promise<void>,
	): Promise<void> => {
		const request = new AbortController();
		requests.set(chatId, request);
		try {
			await run(request.signal);
		} catch (error) {
			if (!request.signal.aborted) log(`Skipped automatic branch naming: ${error}`);
		} finally {
			if (requests.get(chatId) === request) requests.delete(chatId);
		}
	};

	const applyRename = async (chatId: string, generated: string): Promise<void> => {
		if (disposed || !armed.has(chatId)) return;
		// Re-read: the generation ran async and the chat may have gained a sibling since.
		const target = deps.target(chatId);
		if (!target) {
			disarm(chatId);
			return;
		}
		const renamed = await deps.rename({
			directory: target.directory,
			currentBranch: target.currentBranch,
			requestedBranch: generated,
		});
		if (!renamed) return;
		// Before recording: a failed record must never leave the chat renameable twice.
		disarm(chatId);
		await deps
			.renamed({ chatId, workSessionId: target.workSessionId, branch: renamed.branch })
			.catch((error: unknown) => {
				log(`Renamed the branch to ${renamed.branch} but could not record it: ${error}`);
			});
	};

	const generate = async (chatId: string, prompt: string, signal: AbortSignal): Promise<void> => {
		const model = armed.get(chatId)?.model;
		const branch = await deps.generate({ chatId, prompt, ...(model ? { model } : {}) });
		if (!branch || signal.aborted || !armed.has(chatId)) return;
		if (deps.isBusy(chatId)) {
			pending.set(chatId, branch);
			return;
		}
		// Inside the slot, so a fast next prompt can't dispatch while the rename settles.
		await applyRename(chatId, branch);
	};

	const generateOnIdle = (chatId: string, state: ArmedProgress): void => {
		const target = deps.target(chatId);
		if (!target) {
			disarm(chatId);
			return;
		}
		void withSlot(chatId, async (signal) => {
			const hasWork = await deps
				.hasCopyWork({
					directory: target.directory,
					...(state.baseRef ? { baseBranch: state.baseRef } : {}),
				})
				.catch(() => false);
			if (signal.aborted || !armed.has(chatId)) return;
			if (!hasWork) {
				update(chatId, { idleAttempted: false });
				return;
			}
			await generate(chatId, "", signal);
		});
	};

	return {
		arm(chatId, options) {
			if (disposed || armed.has(chatId)) return;
			armed.set(chatId, {
				promptCount: 0,
				idleAttempted: false,
				...(options?.baseRef ? { baseRef: options.baseRef } : {}),
			});
			save();
		},

		prompt({ chatId, text, model }) {
			if (disposed) return;
			const state = armed.get(chatId);
			if (!state) return;
			if (!deps.target(chatId)) {
				disarm(chatId);
				return;
			}
			const promptCount = state.promptCount + 1;
			if (promptCount > MAX_PROMPTS) {
				disarm(chatId);
				return;
			}
			const { model: _previous, ...rest } = state;
			armed.set(chatId, {
				...rest,
				promptCount,
				idleAttempted: false,
				...(model ? { model } : {}),
			});
			save();
			// Prompt 1 only counts; an in-flight request or a held name occupies the slot.
			if (promptCount < 2 || requests.has(chatId) || pending.has(chatId)) return;
			void withSlot(chatId, (signal) => generate(chatId, text, signal));
		},

		turnEnded(chatId) {
			if (disposed) return;
			const state = armed.get(chatId);
			if (!state || deps.isBusy(chatId)) return;
			const held = pending.get(chatId);
			if (held !== undefined) {
				pending.delete(chatId);
				void withSlot(chatId, () => applyRename(chatId, held));
				return;
			}
			if (state.promptCount !== 1 || state.idleAttempted || requests.has(chatId)) return;
			update(chatId, { idleAttempted: true });
			generateOnIdle(chatId, state);
		},

		forget: (chatId) => disarm(chatId),

		dispose() {
			disposed = true;
			for (const request of requests.values()) request.abort();
			requests.clear();
			pending.clear();
		},
	};
}
