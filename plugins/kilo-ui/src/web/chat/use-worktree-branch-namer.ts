import { useEffect, useMemo, useRef } from "react";

import {
	createWorktreeBranchNamer,
	type BranchNamerPrompt,
	type WorktreeBranchNamerDeps,
} from "./worktree-branch-namer.js";

export interface UseWorktreeBranchNamerResult {
	/** Arm a freshly created session for one automatic rename. Stable identity. */
	arm: (sessionID: string, options?: { baseRef?: string }) => void;
	/** Called for every outgoing user message. Stable identity. */
	prompt: (input: BranchNamerPrompt) => void;
}

/**
 * Owns the `WorktreeBranchNamer`'s lifecycle inside an effect instead of a
 * `useMemo` + separate cleanup effect: under React 19 StrictMode, a `useMemo`
 * factory runs its side effect (the `sessionActivity.subscribe` call inside
 * `createWorktreeBranchNamer`) twice, and the mount/cleanup/mount dance on a
 * *separate* `useEffect` disposes the one-and-only memoized instance on the
 * first cleanup — permanently, because the memo is never recomputed. From
 * then on `arm()`/`prompt()` on the stale instance are no-ops, so automatic
 * renaming silently stops working for the rest of the session.
 *
 * The fix: create and dispose the namer in the *same* effect, so
 * StrictMode's mount → cleanup → mount replay creates a fresh instance on
 * the second mount instead of reusing (and re-disposing) the first one.
 *
 * The effect depends on `deps.sessionActivity` only — it's the one
 * dependency that must be a stable instance, because it's what the namer
 * subscribes to. Every other dep is read through a ref on every call, so
 * callers can pass a fresh inline `deps` object each render without
 * restarting the namer (which would drop in-flight arming).
 */
export function useWorktreeBranchNamer(
	deps: WorktreeBranchNamerDeps,
): UseWorktreeBranchNamerResult {
	const depsRef = useRef(deps);
	depsRef.current = deps;

	const namerRef = useRef<ReturnType<typeof createWorktreeBranchNamer> | null>(null);

	useEffect(() => {
		const namer = createWorktreeBranchNamer({
			getConnection: () => depsRef.current.getConnection(),
			sessionActivity: deps.sessionActivity,
			renameWorktreeBranch: (input) => depsRef.current.renameWorktreeBranch(input),
			...(deps.hasWorktreeWork
				? {
						hasWorktreeWork: (
							input: Parameters<NonNullable<WorktreeBranchNamerDeps["hasWorktreeWork"]>>[0],
						) => depsRef.current.hasWorktreeWork!(input),
					}
				: {}),
			...(deps.createDirectoryClient
				? {
						createDirectoryClient: (directory: string) =>
							depsRef.current.createDirectoryClient!(directory),
					}
				: {}),
			...(deps.notify ? { notify: (message: string) => depsRef.current.notify?.(message) } : {}),
			...(deps.log ? { log: (message: string) => depsRef.current.log?.(message) } : {}),
		});
		namerRef.current = namer;
		return () => {
			namer.dispose();
			namerRef.current = null;
		};
		// Deliberately scoped to `sessionActivity`'s identity only — see the
		// doc comment above.
	}, [deps.sessionActivity]);

	return useMemo(
		() => ({
			arm: (sessionID: string, options?: { baseRef?: string }) =>
				namerRef.current?.arm(sessionID, options),
			prompt: (input: BranchNamerPrompt) => namerRef.current?.prompt(input),
		}),
		[],
	);
}
