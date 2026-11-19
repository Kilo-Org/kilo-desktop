import { useEffect, useRef, useState } from "react";

import type {
	CondaRepodataFindResult,
	CondaRepodataPackage,
} from "../../../contracts/providers/conda";
import type { CondaClient } from "../../conda";
import { useAnacondaAccountKey } from "./use-anaconda-account-key";

/** First request size, and how much each scroll-triggered request adds. */
export const PACKAGE_SEARCH_BATCH = 50;
/** Hard cap on results; `findRepodata` rejects larger limits. */
export const PACKAGE_SEARCH_CAP = 500;
const DEBOUNCE_MS = 200;

interface LoadedResults {
	key: string;
	limit: number;
	packages: CondaRepodataPackage[];
	truncated: boolean;
}

interface UsePackageSearchOptions {
	conda: CondaClient;
	/** Search only while the owning dialog is open. */
	open: boolean;
	/** Hold the first request until the channel list is known. */
	ready: boolean;
	query: string;
	channels: string[] | undefined;
}

export interface PackageSearch {
	/**
	 * Results for the current query/channels, or — while its first batch is in
	 * flight — the previous query's, so typing does not blank the list.
	 */
	packages: CondaRepodataPackage[];
	/** First batch for the current query/channels is in flight. */
	loading: boolean;
	/** A wider batch is in flight; `packages` still holds the previous one. */
	loadingMore: boolean;
	/** More results exist and can be requested with `loadMore`. */
	hasMore: boolean;
	/** More results exist, but the cap was reached: the user must refine. */
	atCap: boolean;
	loadMore: () => void;
}

function dedupeByName(packages: CondaRepodataPackage[]): CondaRepodataPackage[] {
	const seen = new Map<string, CondaRepodataPackage>();
	for (const pkg of packages) {
		if (!seen.has(pkg.name)) seen.set(pkg.name, pkg);
	}
	return Array.from(seen.values());
}

/**
 * Remote package search that grows on scroll instead of paginating.
 *
 * The first request asks for one batch; `loadMore` widens `limit` by another
 * batch until the result is no longer truncated or the cap is hit. `limit` is
 * deliberately left out of the main-side read-cache key, so a wider request
 * reuses the cached backend index and returns the same leading rows — the list
 * extends in place and keeps its scroll position.
 */
export function usePackageSearch({
	conda,
	open,
	ready,
	query,
	channels,
}: UsePackageSearchOptions): PackageSearch {
	const trimmed = query.trim();
	// The account is part of the key: repodata is filtered for it.
	const account = useAnacondaAccountKey();
	const key = JSON.stringify([trimmed, channels ?? null, account]);
	const [requested, setRequested] = useState({ key, limit: PACKAGE_SEARCH_BATCH });
	const [loaded, setLoaded] = useState<LoadedResults | null>(null);
	const loadedKeyRef = useRef<string | null>(null);

	// A new query or channel set starts again from the first batch.
	const limit = requested.key === key ? requested.limit : PACKAGE_SEARCH_BATCH;
	if (requested.key !== key) setRequested({ key, limit: PACKAGE_SEARCH_BATCH });

	useEffect(() => {
		if (!open || !ready) return;
		let stale = false;
		const widening = loadedKeyRef.current === key;
		const timer = setTimeout(
			() => {
				const args = {
					...(trimmed ? { query: trimmed } : {}),
					limit,
					...(channels ? { channels } : {}),
				};
				conda
					.findRepodata(args)
					.then((result) => {
						if (stale) return;
						const { packages, truncated } = result as CondaRepodataFindResult;
						loadedKeyRef.current = key;
						setLoaded({ key, limit, packages: dedupeByName(packages), truncated });
					})
					.catch(() => {
						if (stale) return;
						loadedKeyRef.current = key;
						setLoaded({ key, limit, packages: [], truncated: false });
					});
			},
			widening ? 0 : DEBOUNCE_MS,
		);
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	}, [open, ready, key, trimmed, channels, limit, conda]);

	// Results from another session would be stale on reopen; keep only a batch
	// that still matches the (reset) query.
	if (!open && loaded !== null && loaded.key !== key) setLoaded(null);

	const current = loaded?.key === key ? loaded : null;
	const loading = current === null;
	const loadingMore = current !== null && current.limit < limit;
	const hasMore = current !== null && current.truncated && current.limit < PACKAGE_SEARCH_CAP;
	const atCap = current !== null && current.truncated && current.limit >= PACKAGE_SEARCH_CAP;

	const loadMore = () => {
		if (!hasMore || loadingMore) return;
		setRequested((prev) =>
			prev.key === key
				? { key, limit: Math.min(PACKAGE_SEARCH_CAP, prev.limit + PACKAGE_SEARCH_BATCH) }
				: prev,
		);
	};

	return {
		packages: (current ?? loaded)?.packages ?? [],
		loading,
		loadingMore,
		hasMore,
		atCap,
		loadMore,
	};
}
