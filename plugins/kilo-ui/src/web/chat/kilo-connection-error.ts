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
