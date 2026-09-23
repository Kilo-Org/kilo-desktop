import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";

import { useWorkspaceWatcher } from "@kilo-desktop/sdk-react";

const DEBOUNCE_MS = 75;
/** Upper bound on deferral so a continuously written file cannot starve refreshes. */
const MAX_WAIT_MS = 1_000;
const GIT_METADATA_PATH = /(?:^|[\\/])\.git(?:[\\/]|$)/;
const EXCLUDES = ["**/node_modules/**"];

type PendingInvalidation = { gitMetadata: boolean; paths: Set<string> };

function normalizePath(value: string): string {
	const slashed = value.replace(/\\/g, "/").replace(/\/+$/, "");
	// Windows paths compare case-insensitively.
	return /^[a-z]:\//i.test(slashed) ? slashed.toLowerCase() : slashed;
}

function queryDirectory(query: Query): string | null {
	const input = query.queryKey[2];
	if (input === null || typeof input !== "object") return null;
	const directory = (input as { workingDirectory?: unknown }).workingDirectory;
	return typeof directory === "string" ? normalizePath(directory) : null;
}

/**
 * App-lifetime subscriber for local repository state. Ordinary workspace
 * changes invalidate `status`/`workingTreeStats` only for directories that
 * contain a changed path, debounced with a max wait. `.git` changes —
 * including HEAD, refs, and the index, which for a worktree live in the
 * main repository's `.git` — invalidate those queries for every directory
 * plus ref and repository metadata. Remote fetches remain on a separate
 * lifecycle so a formatter or agent edit cannot cause network I/O.
 */
export function GitRepositoryWatcherProvider({ children }: { readonly children: ReactNode }) {
	const queryClient = useQueryClient();
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const firstPendingAtRef = useRef<number | null>(null);
	const pendingRef = useRef<PendingInvalidation>({ gitMetadata: false, paths: new Set() });

	useEffect(
		() => () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		},
		[],
	);

	function flush() {
		timerRef.current = null;
		firstPendingAtRef.current = null;
		const pending = pendingRef.current;
		pendingRef.current = { gitMetadata: false, paths: new Set() };
		const paths = [...pending.paths];
		const affected = (query: Query) => {
			if (pending.gitMetadata) return true;
			const directory = queryDirectory(query);
			// Unknown key shapes are refreshed conservatively.
			if (directory === null) return true;
			return paths.some((path) => path === directory || path.startsWith(`${directory}/`));
		};
		for (const channel of ["status", "workingTreeStats"] as const) {
			void queryClient.invalidateQueries({ queryKey: ["git", channel], predicate: affected });
		}
		if (pending.gitMetadata) {
			void queryClient.invalidateQueries({ queryKey: ["git", "branches"] });
			void queryClient.invalidateQueries({ queryKey: ["git", "repositoryType"] });
		}
	}

	useWorkspaceWatcher({
		types: ["create", "update", "delete"],
		excludes: EXCLUDES,
		onFileChange: (event) => {
			for (const change of event.changes) {
				if (GIT_METADATA_PATH.test(change.path)) pendingRef.current.gitMetadata = true;
				else pendingRef.current.paths.add(normalizePath(change.path));
			}
			const now = Date.now();
			firstPendingAtRef.current ??= now;
			if (timerRef.current) clearTimeout(timerRef.current);
			const remaining = MAX_WAIT_MS - (now - firstPendingAtRef.current);
			timerRef.current = setTimeout(flush, Math.max(0, Math.min(DEBOUNCE_MS, remaining)));
		},
	});

	return children;
}
