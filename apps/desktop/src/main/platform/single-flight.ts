/**
 * Wraps an async, argument-less function so concurrent callers share one
 * in-flight promise. The promise is forgotten once it settles, so a later call
 * starts a fresh run.
 */
export function singleFlight<R>(fn: () => Promise<R>): () => Promise<R> {
	let inFlight: Promise<R> | undefined;
	return function singleFlightWrapper(): Promise<R> {
		inFlight ??= fn().finally(() => {
			inFlight = undefined;
		});
		return inFlight;
	};
}
