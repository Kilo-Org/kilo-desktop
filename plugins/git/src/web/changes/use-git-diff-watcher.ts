import { useEffect, useEffectEvent, useRef, useState } from "react";
import useDebounce from "react-use/esm/useDebounce.js";
import useLatest from "react-use/esm/useLatest.js";

import { useQuery } from "@tanstack/react-query";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import {
	createWorkspaceChangeFilter,
	escapeGlob,
	FileWatcher,
	toPosixPath,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { useStableValue } from "@kilo-desktop/ui/hooks/use-stable";

import { Repository } from "../../contracts";
import { repositoryTypeQuery } from "../shared/repository-queries";
import { resolveDiffWatchScope } from "./lib/diff-watch-scope";
import { Throttler } from "./lib/throttler";
import type { PaneVisibility } from "./use-pane-visibility";

const REFRESH_DEBOUNCE_MS = 1_000;
const AUTO_REFRESH_COOLDOWN_MS = 5_000;
// The agent host's `DEFAULT_AGENT_HOST_WATCH_EXCLUDES`, minus the entries
// the git-dir includes can never match.
const GIT_DIR_NOISE_EXCLUDES = [
	"**/.git/**/*.lock",
	"**/.git/**/FETCH_HEAD",
	"**/.git/**/fsmonitor--daemon/**",
	"**/*.watchman-cookie-*",
];

const TRAILING_SLASHES = /\/+$/u;

const sameContent = (previous: unknown, next: unknown): boolean =>
	JSON.stringify(previous) === JSON.stringify(next);

/**
 * Calls `onFileChange` for kilo.work-sessions' file changes matching the globs
 * (`dirs` are native directories, watched recursively) while `enabled`.
 */
function useFileChanges(options: {
	readonly dirs?: readonly string[];
	readonly includes?: readonly string[];
	readonly excludes: readonly string[];
	readonly enabled: boolean;
	readonly onFileChange: () => void;
}): void {
	const files = useDomainObject(FileWatcher);
	const onFileChange = useLatest(options.onFileChange);
	const includes = [
		...(options.includes ?? []),
		...(options.dirs ?? []).map(
			(dir) => `${escapeGlob(toPosixPath(dir).replace(TRAILING_SLASHES, ""))}/**`,
		),
	];
	const spec = useStableValue({ includes, excludes: options.excludes }, sameContent);
	const filter = createWorkspaceChangeFilter({
		includes: spec.includes,
		excludes: [...spec.excludes],
	});

	useEffect(() => {
		if (!files || !options.enabled) return;
		return files.on("changed", (event) => {
			if (filter(event.changes).length > 0) onFileChange.current();
		});
	}, [files, filter, onFileChange, options.enabled]);
}

/** Resolves after `ms`, or as soon as `signal` aborts; never rejects. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const onAbort = () => {
			clearTimeout(timeout);
			resolve();
		};
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export interface UseGitDiffWatcherOptions {
	/** Absolute workspace directory the diff is generated for. */
	readonly directory: string;
	/** The loader's coalesced refresh; settles when the load it joined does. */
	readonly refresh: () => Promise<void>;
	/** Stops watching (no subscriptions, no scheduled refreshes). */
	readonly paused: boolean;
	/** Gates auto-refreshes on the pane being seen. */
	readonly visibility: PaneVisibility;
}

/**
 * Refreshes the working-directory diff when kilo.work-sessions' file watcher reports file
 * changes in the repository `directory` belongs to, following VS Code's
 * git extension.
 *
 * The watch scope is VS Code's `repositoryWatcher` plus its `DotGitWatcher`:
 * the working tree, with everything under any `.git` directory excluded so
 * git's object churn — including our own diff generation's `git add -A`
 * blob writes — never triggers, plus the first level of the git dir (glob
 * `*`, so commits, stages and checkouts that touch no working-tree file
 * still refresh). The git-dir subscription drops the agent host's noise
 * (`agentHostFileMonitorService`'s excludes): lock files at any depth,
 * `FETCH_HEAD` (background fetches), the fsmonitor daemon's dir and
 * watchman cookies.
 *
 * The scope comes from the shared `repositoryType` query
 * (`resolveDiffWatchScope`): the patch is tree-wide, so the working tree
 * is the repo's top-level directory even for a subfolder view. `gitDir`
 * can be realpath'd while events carry workspace-path form, so a `.git`
 * dir is globbed under the syntactic top level and a linked worktree's
 * admin dir by its real name (`**` + `/.git/worktrees/<name>/…`); only a
 * separate git dir is globbed by its absolute path, best effort. While
 * the query is unresolved, or the folder is not a regular repository,
 * the scope falls back to treating `directory` as the repo root and
 * guessing the admin dir from its folder name — that fallback's `.git`
 * include is what catches a terminal `git init` after a not-a-repo 404.
 * Known limitation: the workspace watcher only watches registered
 * workspace folders, so a repo root or git dir outside all of them
 * produces no events (the Refresh button still works).
 *
 * One app-specific exclude, not from VS Code: the working-tree
 * subscription also skips `<top level>/.kilo/worktrees/` and everything
 * under it. Chat worktrees live under the main repo's folder but are
 * excluded from its git (`info/exclude`), so their edits can never
 * change this diff. The exclude must be anchored — a worktree view's own
 * top level is exactly that path, so the same segments globbed at any
 * depth would silence the worktree's own files.
 *
 * Scheduling follows the SCM `Repository` pipeline — `onFileChange` →
 * `@debounce(1000)` → `@throttle updateWhenIdleAndWait` — minus its
 * operations-idle wait. Matching changes bump a monotonic counter that
 * arms a trailing 1000 ms debounce; its fire queues one auto-refresh on
 * this hook's own per-directory `Throttler`. The task waits for the pane
 * to be visible (in place of VS Code's window-focus wait), refreshes, then
 * holds the throttler slot through a 5 s cooldown (the SCM's
 * `timeout(5000)`, and the agent host's "at most every 5 seconds"), so
 * changes meanwhile collapse into one follow-up that
 * starts after it. A follow-up that finds no change since the previous
 * auto-refresh started skips itself, so a hidden stretch or a folder
 * switch never costs a second refresh. Manual refreshes go straight to
 * the loader and never wait for the cooldown. The counter is never reset
 * and useDebounce fires once on mount, hence the zero-count guard.
 */
export function useGitDiffWatcher({
	directory,
	refresh,
	paused,
	visibility,
}: UseGitDiffWatcherOptions): void {
	const enabled = !paused;
	const [changeCount, bumpChangeCount] = useState(0);
	const refreshRef = useLatest(refresh);
	const pausedRef = useLatest(paused);
	const changeCountRef = useLatest(changeCount);
	// The change count the latest auto-refresh (or the folder's first load)
	// already covers.
	const coveredChangeCountRef = useRef(0);
	const queueAutoRefreshRef = useRef<(() => void) | undefined>(undefined);

	// A folder's first load covers the changes seen before it was shown.
	const coverChangesBefore = useEffectEvent((_folder: string) => {
		coveredChangeCountRef.current = changeCount;
	});

	useEffect(() => {
		coverChangesBefore(directory);
		const throttler = new Throttler();
		const runAutoRefresh = async (signal: AbortSignal): Promise<void> => {
			await visibility.whenVisible(signal);
			if (
				signal.aborted ||
				pausedRef.current ||
				changeCountRef.current === coveredChangeCountRef.current
			) {
				return;
			}
			coveredChangeCountRef.current = changeCountRef.current;
			await refreshRef.current();
			await sleep(AUTO_REFRESH_COOLDOWN_MS, signal);
		};
		queueAutoRefreshRef.current = () => {
			throttler.queue(runAutoRefresh).catch(() => undefined);
		};
		return () => {
			throttler.dispose();
		};
	}, [changeCountRef, directory, pausedRef, refreshRef, visibility]);

	useDebounce(
		() => {
			if (changeCount === 0) return; // useDebounce fires once on mount
			queueAutoRefreshRef.current?.();
		},
		REFRESH_DEBOUNCE_MS,
		[changeCount],
	);

	const repository = useDomainObject(Repository);
	const { data: repositoryType } = useQuery(repositoryTypeQuery(repository, directory));
	const scope = resolveDiffWatchScope(directory, repositoryType);
	const onFileChange = () => bumpChangeCount((count) => count + 1);
	useFileChanges({
		dirs: scope.workingTreeDirs,
		excludes: scope.workingTreeExcludes,
		enabled,
		onFileChange,
	});
	useFileChanges({
		includes: scope.gitDirIncludes,
		excludes: GIT_DIR_NOISE_EXCLUDES,
		enabled,
		onFileChange,
	});
}
