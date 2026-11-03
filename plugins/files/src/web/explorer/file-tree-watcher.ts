import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import useDebounce from "react-use/esm/useDebounce.js";

import { useWorkspaceFileChanges } from "../file-changes.js";

/**
 * Query keys for the explorer's live workspace queries. Shared between the
 * FilesView queries and the file-tree-watcher invalidations so a watcher batch
 * lands on exactly the cached scans it affects.
 */
export function filesListQueryKey(workspaceDirectory: string): readonly unknown[] {
	return ["kilo.files", "workspace-list", workspaceDirectory];
}

export function filesGitStatusQueryKey(workspaceDirectory: string): readonly unknown[] {
	return ["kilo.files", "git-status", workspaceDirectory];
}

const REFRESH_DEBOUNCE_MS = 300;

/**
 * Keeps the explorer's react-query scans in step with disk, vscode-style. All
 * filtering lives in the watcher subscriptions: both are scoped to this
 * pane's root via the `dirs` option (posix-normalized, glob-escaped, `/**`
 * appended, so folders with glob-magic chars such as `proj[1]` work), git status refetches on any matching batch (any
 * change can move decorations, e.g. .git/index churn), and the list refetches
 * only on creates and deletes — including deletes of paths the list never
 * contained, mirroring how creates already behaved (gitignore membership is
 * unknowable client-side); updates never affect the alphabetically-sorted list.
 * Matching changes bump monotonic counters — the `useDebounce` dependencies —
 * which arm trailing 300 ms timers to absorb watcher bursts; react-use cancels
 * the timers automatically on unmount. Counters are never reset: a reset would
 * re-arm a timer into a guarded no-op fire and double renders per cycle.
 * useDebounce fires once on mount with the initial deps, hence the zero-count
 * guards; its internal callback ref means a fire always reads the latest
 * committed render, so a fire after a folder switch simply targets the new
 * folder's queries, which is harmless. Window-focus refresh is not this hook's
 * concern: the queries in FilesView own it via their refetchOnWindowFocus option.
 */
export function useFileTreeWatcher(workspaceDirectory: string): void {
	const queryClient = useQueryClient();
	const [gitVersion, bumpGitVersion] = useState(0);
	const [listVersion, bumpListVersion] = useState(0);

	useDebounce(
		() => {
			if (gitVersion === 0) return; // useDebounce fires once on mount
			void queryClient.invalidateQueries({
				queryKey: filesGitStatusQueryKey(workspaceDirectory),
			});
		},
		REFRESH_DEBOUNCE_MS,
		[gitVersion],
	);

	useDebounce(
		() => {
			if (listVersion === 0) return; // useDebounce fires once on mount
			void queryClient.invalidateQueries({
				queryKey: filesListQueryKey(workspaceDirectory),
			});
		},
		REFRESH_DEBOUNCE_MS,
		[listVersion],
	);

	useWorkspaceFileChanges({
		dirs: [workspaceDirectory],
		onFileChange: () => bumpGitVersion((count) => count + 1),
	});
	useWorkspaceFileChanges({
		dirs: [workspaceDirectory],
		types: ["create", "delete"],
		onFileChange: () => bumpListVersion((count) => count + 1),
	});
}
