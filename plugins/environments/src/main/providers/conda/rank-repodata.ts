/**
 * Filter `entries` to those whose name matches `query`, ordered by
 * relevance: exact name, then prefix, then substring; ties keep the input
 * order (stable). Non-matching names are dropped entirely. Matching is
 * case-insensitive.
 *
 * Mirrors the bridge's own `repodata.find` query ranking, so re-ranking a
 * bridge-ranked result is a no-op; it matters only for older bridges that
 * ignore `query` and return the whole index.
 */
export function rankRepodataMatches<T extends { readonly name: string }>(
	entries: readonly T[],
	query: string,
): T[] {
	const needle = query.toLowerCase();

	const scored: Array<{ entry: T; rank: number; order: number }> = [];
	for (const [order, entry] of entries.entries()) {
		const name = entry.name.toLowerCase();
		const rank = name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : -1;
		if (rank === -1) continue;
		scored.push({ entry, rank, order });
	}

	scored.sort((a, b) => a.rank - b.rank || a.order - b.order);
	return scored.map(({ entry }) => entry);
}
