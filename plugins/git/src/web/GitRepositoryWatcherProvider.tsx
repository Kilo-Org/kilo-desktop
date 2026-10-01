import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient, type Query, type QueryKey } from "@tanstack/react-query";

import { useWorkspaceWatcher } from "@kilo-desktop/sdk-react";

const DEBOUNCE_MS = 75;
/** Upper bound on deferral so a continuously written file cannot starve refreshes. */
const MAX_WAIT_MS = 1_000;
const GIT_METADATA_PATH = /(?:^|[\\/])\.git(?:[\\/]|$)/;
/**
 * Besides dependency trees: VS Code's agent-host git noise
 * (`DEFAULT_AGENT_HOST_WATCH_EXCLUDES`) minus its `**\/.git` — `git init`
 * must still flip `repositoryType` — plus linked-worktree reflogs and the
 * scratch files git writes alongside HEAD/index. Unlike VS Code's
 * `DotGitWatcher`, refs below the first level still trigger so a branch
 * created from a terminal reaches the picker.
 */
const EXCLUDES = [
	"**/node_modules/**",
	"**/.git/lfs/**",
	"**/.git/logs/**",
	"**/.git/worktrees/*/logs/**",
	"**/.git/objects/**",
	"**/.git/subtree-cache/**",
	"**/.git/**/*.lock",
	"**/.git/**/FETCH_HEAD",
	"**/.git/**/ORIG_HEAD",
	"**/.git/**/COMMIT_EDITMSG",
	"**/.git/**/fsmonitor--daemon/**",
	"**/*.watchman-cookie-*",
];
const WORKING_TREE_CHANNELS = ["status", "workingTreeStats"] as const;
const METADATA_CHANNELS = [...WORKING_TREE_CHANNELS, "branches", "repositoryType"] as const;

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
 * plus ref and repository metadata; `.git` noise is excluded up front.
 *
 * Refreshes are single-flight per query: a superseded IPC call cannot be
 * aborted and keeps its git processes running in main, so an in-flight
 * query is never restarted. It is recorded instead and refetched exactly
 * once when its fetch settles, successfully or not (driven by the query
 * cache, not a timer), so a change that lands mid-fetch is still picked up.
 * Remote fetches remain on a separate lifecycle so a formatter or agent
 * edit cannot cause network I/O.
 */
export function GitRepositoryWatcherProvider({ children }: { readonly children: ReactNode }) {
	const queryClient = useQueryClient();
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const firstPendingAtRef = useRef<number | null>(null);
	const pendingRef = useRef<PendingInvalidation>({ gitMetadata: false, paths: new Set() });
	const trailingRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		const trailing = trailingRef.current;
		const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
			const { queryHash } = event.query;
			if (!trailing.has(queryHash)) return;
			if (event.type === "removed") {
				trailing.delete(queryHash);
				return;
			}
			if (event.query.state.fetchStatus !== "idle") return;
			// Delete first: the invalidation below emits cache events for this hash.
			trailing.delete(queryHash);
			void queryClient.invalidateQueries(
				{ queryKey: event.query.queryKey, exact: true },
				{ cancelRefetch: false },
			);
		});
		return () => {
			unsubscribe();
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [queryClient]);

	function refreshSingleFlight(queryKey: QueryKey, affected: (query: Query) => boolean) {
		for (const query of queryClient.getQueryCache().findAll({ queryKey, predicate: affected })) {
			if (query.state.fetchStatus === "fetching") trailingRef.current.add(query.queryHash);
		}
		void queryClient.invalidateQueries(
			{ queryKey, predicate: (query) => affected(query) && query.state.fetchStatus !== "fetching" },
			{ cancelRefetch: false },
		);
	}

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
		const channels = pending.gitMetadata ? METADATA_CHANNELS : WORKING_TREE_CHANNELS;
		for (const channel of channels) refreshSingleFlight(["git", channel], affected);
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
