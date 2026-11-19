import { useState } from "react";

/**
 * Track when the conda backend's "not ready" streak began.
 *
 * Returns the epoch-ms timestamp (`failedAt`) of the first *settled*
 * `PROVIDER_NOT_READY` failure, held stable until the read `resolved` (succeeded, or settled into a
 * different error), then reset to `null`.
 *
 * It latches on settled signals rather than on the live query state on
 * purpose: TanStack Query cycles a still-empty query (`data === undefined`)
 * back through `status: "pending"` / `error: null` at the start of *every*
 * background refetch (`fetchState` in query-core). While the 3s poll runs,
 * `notReady` therefore drops to `false` momentarily without the backend having
 * recovered. Resetting the clock on that transient would restart the 120s
 * startup window every poll and the manual retry would never surface, so we
 * clear only on a real `resolved` transition.
 */
export function useProviderNotReadySince({
	notReady,
	resolved,
	failedAt,
}: {
	/** True only when the query has *settled* on a PROVIDER_NOT_READY error. */
	notReady: boolean;
	/** True once the read has succeeded or settled on a non-not-ready error. */
	resolved: boolean;
	/** Epoch ms when the query last settled on an error (`errorUpdatedAt`). */
	failedAt: number;
}): number | null {
	const [since, setSince] = useState<number | null>(null);

	if (resolved) {
		if (since !== null) setSince(null);
	} else if (notReady && since === null) {
		setSince(failedAt);
	}

	return since;
}
