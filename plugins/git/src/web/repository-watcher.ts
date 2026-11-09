import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

import {
	createWorkspaceChangeFilter,
	type FileChangeEvent,
} from "@kilo-desktop/plugin-workspaces/contracts";

import type { RepositoryQueryMethod } from "./repository-queries.js";

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
const WORKING_TREE_METHODS: readonly RepositoryQueryMethod[] = ["status", "workingTreeStats"];
const METADATA_METHODS: readonly RepositoryQueryMethod[] = [
	...WORKING_TREE_METHODS,
	"branches",
	"repositoryType",
	"worktrees",
];

type PendingInvalidation = { gitMetadata: boolean; paths: Set<string> };

export interface FileChangeSource {
	on(event: "changed", listener: (event: FileChangeEvent) => void): () => void;
}

function normalizePath(value: string): string {
	const slashed = value.replace(/\\/g, "/").replace(/\/+$/, "");
	return /^[a-z]:\//i.test(slashed) ? slashed.toLowerCase() : slashed;
}

function queryDirectory(query: Query): string | null {
	const input = query.queryKey[2];
	if (input === null || typeof input !== "object") return null;
	const directory = (input as { directory?: unknown }).directory;
	return typeof directory === "string" ? normalizePath(directory) : null;
}

/**
 * Keeps a window's cached repository reads current from kilo.workspaces'
 * file changes. Ordinary changes refresh `status` only for directories that
 * contain a changed path, debounced with a max wait. `.git` changes —
 * HEAD, refs and the index, which for a worktree live in the main
 * repository's `.git` — refresh it for every directory, plus branches,
 * worktrees and repository types; `.git` noise is excluded up front.
 *
 * Refreshes are single-flight per query: a superseded call cannot be
 * aborted and keeps its git processes running in main, so an in-flight
 * query is never restarted. It is recorded instead and refetched exactly
 * once when its fetch settles, successfully or not (driven by the query
 * cache, not a timer), so a change that lands mid-fetch is still picked up.
 */
export function watchRepositoryQueries(files: FileChangeSource, queries: QueryClient): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let firstPendingAt: number | null = null;
	let pending: PendingInvalidation = { gitMetadata: false, paths: new Set() };
	const trailing = new Set<string>();
	const filter = createWorkspaceChangeFilter({ excludes: EXCLUDES });

	const stopTrailing = queries.getQueryCache().subscribe((event) => {
		const { queryHash } = event.query;
		if (!trailing.has(queryHash)) return;
		if (event.type === "removed") {
			trailing.delete(queryHash);
			return;
		}
		if (event.query.state.fetchStatus !== "idle") return;
		trailing.delete(queryHash);
		void queries.invalidateQueries(
			{ queryKey: event.query.queryKey, exact: true },
			{ cancelRefetch: false },
		);
	});

	function refreshSingleFlight(queryKey: QueryKey, affected: (query: Query) => boolean) {
		for (const query of queries.getQueryCache().findAll({ queryKey, predicate: affected })) {
			if (query.state.fetchStatus === "fetching") trailing.add(query.queryHash);
		}
		void queries.invalidateQueries(
			{ queryKey, predicate: (query) => affected(query) && query.state.fetchStatus !== "fetching" },
			{ cancelRefetch: false },
		);
	}

	function flush() {
		timer = null;
		firstPendingAt = null;
		const flushed = pending;
		pending = { gitMetadata: false, paths: new Set() };
		const paths = [...flushed.paths];
		const affected = (query: Query) => {
			if (flushed.gitMetadata) return true;
			const directory = queryDirectory(query);
			if (directory === null) return true;
			return paths.some((path) => path === directory || path.startsWith(`${directory}/`));
		};
		const methods = flushed.gitMetadata ? METADATA_METHODS : WORKING_TREE_METHODS;
		for (const method of methods) refreshSingleFlight(["git", method], affected);
	}

	const stopChanges = files.on("changed", (event) => {
		const changes = filter(event.changes);
		if (changes.length === 0) return;
		for (const change of changes) {
			if (GIT_METADATA_PATH.test(change.path)) pending.gitMetadata = true;
			else pending.paths.add(normalizePath(change.path));
		}
		const now = Date.now();
		firstPendingAt ??= now;
		if (timer) clearTimeout(timer);
		const remaining = MAX_WAIT_MS - (now - firstPendingAt);
		timer = setTimeout(flush, Math.max(0, Math.min(DEBOUNCE_MS, remaining)));
	});

	return () => {
		stopChanges();
		stopTrailing();
		if (timer) clearTimeout(timer);
	};
}
