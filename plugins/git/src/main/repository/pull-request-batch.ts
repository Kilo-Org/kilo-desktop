/**
 * One `gh api graphql` document that answers the per-directory pull request
 * ladder for up to BATCH_CHUNK_SIZE checkouts of one repository, modeled on
 * the VS Code Agent Manager's batched full sync. Per checkout it asks for:
 *
 * - `b<i>`: PRs headed by the branch name, in the states and order `gh pr
 *   view <branch>` searches (its finder), so both paths pick the same PR;
 * - `u<i>`: the same for the upstream branch name when it differs, which is
 *   what `gh pr view` without an argument resolves through branch config;
 * - `c<i>`: PRs associated with HEAD, standing in for the open-PR SHA search.
 *
 * Nodes are requested in the `gh pr view --json` field names so the
 * per-directory parsers read them unchanged. Every name and SHA travels as a
 * raw-string variable (`-f`), never interpolated into the document.
 */

export const BATCH_CHUNK_SIZE = 10;

const NODE_FIELDS =
	"number url title baseRefName headRefName state isDraft headRefOid mergeCommit { oid } isCrossRepository";
const NAME_LOOKUP =
	"states: [OPEN, CLOSED, MERGED], first: 30, orderBy: { field: CREATED_AT, direction: DESC }";

export interface BatchLookup {
	readonly branch: string;
	/** The upstream branch name without its remote, when it differs from `branch`. */
	readonly upstreamBranch: string | null;
	readonly sha: string;
}

export interface BatchNodes {
	readonly byBranch: readonly Record<string, unknown>[];
	readonly byUpstream: readonly Record<string, unknown>[];
	readonly byHead: readonly Record<string, unknown>[];
}

/** `gh api graphql` arguments for one chunk of lookups in `owner/name`. */
export function batchQueryArgs(
	host: string,
	repository: { owner: string; name: string },
	lookups: readonly BatchLookup[],
): string[] {
	const variables: string[] = ["$owner: String!", "$name: String!"];
	const fields: string[] = [];
	const values: [string, string][] = [
		["owner", repository.owner],
		["name", repository.name],
	];
	lookups.forEach((lookup, index) => {
		variables.push(`$b${index}: String!`, `$c${index}: GitObjectID!`);
		values.push([`b${index}`, lookup.branch], [`c${index}`, lookup.sha]);
		fields.push(
			`b${index}: pullRequests(headRefName: $b${index}, ${NAME_LOOKUP}) { nodes { ${NODE_FIELDS} } }`,
		);
		fields.push(
			`c${index}: object(oid: $c${index}) { ... on Commit { associatedPullRequests(first: 5) { nodes { ${NODE_FIELDS} } } } }`,
		);
		if (lookup.upstreamBranch) {
			variables.push(`$u${index}: String!`);
			values.push([`u${index}`, lookup.upstreamBranch]);
			fields.push(
				`u${index}: pullRequests(headRefName: $u${index}, ${NAME_LOOKUP}) { nodes { ${NODE_FIELDS} } }`,
			);
		}
	});
	const query = `query(${variables.join(", ")}) { repository(owner: $owner, name: $name) { ${fields.join(" ")} } }`;
	return [
		"api",
		"graphql",
		"--hostname",
		host,
		"-f",
		`query=${query}`,
		...values.flatMap(([key, value]) => ["-f", `${key}=${value}`]),
	];
}

function nodesOf(value: unknown): Record<string, unknown>[] {
	const connection =
		(value as { associatedPullRequests?: unknown } | null)?.associatedPullRequests ?? value;
	const nodes = (connection as { nodes?: unknown } | null)?.nodes;
	return Array.isArray(nodes)
		? nodes.filter(
				(node): node is Record<string, unknown> => node !== null && typeof node === "object",
			)
		: [];
}

/**
 * Per-lookup nodes, or `undefined` for a lookup the batch cannot answer (an
 * error on one of its aliases). A response without repository data, or an
 * error that names no alias, answers nothing.
 */
export function parseBatchResponse(stdout: string, count: number): (BatchNodes | undefined)[] {
	const unanswered = Array.from({ length: count }, () => undefined);
	let payload: { data?: { repository?: Record<string, unknown> | null } | null; errors?: unknown };
	try {
		payload = JSON.parse(stdout) as typeof payload;
	} catch {
		return unanswered;
	}
	const repository = payload.data?.repository;
	if (!repository || typeof repository !== "object") return unanswered;
	const failed = new Set<number>();
	for (const error of Array.isArray(payload.errors) ? payload.errors : []) {
		const alias = (error as { path?: unknown }).path;
		const match = Array.isArray(alias) ? /^[buc](\d+)$/.exec(String(alias[1])) : null;
		if (!match) return unanswered;
		failed.add(Number(match[1]));
	}
	return Array.from({ length: count }, (_, index) =>
		failed.has(index)
			? undefined
			: {
					byBranch: nodesOf(repository[`b${index}`]),
					byUpstream: nodesOf(repository[`u${index}`]),
					byHead: nodesOf(repository[`c${index}`]),
				},
	);
}

/**
 * The PR `gh pr view <branch>` would pick from a name lookup: its finder
 * matches the head label, which is the bare branch only for same-repository
 * PRs, then prefers the newest open PR over the newest closed or merged one.
 */
export function finderPick(
	nodes: readonly Record<string, unknown>[],
): Record<string, unknown> | undefined {
	const sameRepository = nodes.filter((node) => node.isCrossRepository === false);
	return sameRepository.find((node) => node.state === "OPEN") ?? sameRepository[0];
}
