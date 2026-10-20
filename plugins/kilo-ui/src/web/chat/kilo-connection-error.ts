// Ejecting local models rewrites kilo.jsonc and restarts Kilo, so GET /provider
// can 503 with an empty body until the new instance is ready.
const UNAVAILABLE = /503\s+service unavailable/i;

export function isStaleKiloConnectionError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? "");
	return (
		UNAVAILABLE.test(message) ||
		/unauthorized/i.test(message) ||
		/econnrefused/i.test(message) ||
		/failed to fetch/i.test(message)
	);
}

export function shouldRetryStaleKiloQuery(failureCount: number, error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? "");
	return UNAVAILABLE.test(message) && failureCount < 3;
}

export const STALE_KILO_QUERY_RETRY_DELAY_MS = 200;

/**
 * Kilo can answer `GET /provider` with an empty list while its providers are
 * still starting (cold start / restart). The model catalog treats that as a
 * failure so it refetches a bounded number of times instead of caching an empty
 * picker forever.
 */
export class EmptyKiloCatalogError extends Error {
	constructor() {
		super("Kilo returned an empty model catalog");
		this.name = "EmptyKiloCatalogError";
	}
}

export function isEmptyKiloCatalogError(error: unknown): boolean {
	return error instanceof EmptyKiloCatalogError;
}

/** Bounded refetches for an empty catalog before giving up and logging. */
export const EMPTY_KILO_CATALOG_RETRY_LIMIT = 3;
export const EMPTY_KILO_CATALOG_RETRY_DELAY_MS = 1_000;

export function shouldRetryModelCatalogQuery(failureCount: number, error: unknown): boolean {
	if (isEmptyKiloCatalogError(error)) return failureCount < EMPTY_KILO_CATALOG_RETRY_LIMIT;
	return shouldRetryStaleKiloQuery(failureCount, error);
}
