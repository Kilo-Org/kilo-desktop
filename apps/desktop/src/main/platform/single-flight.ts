/**
 * Wraps an async function so concurrent callers share one in-flight promise; the
 * first call's arguments are used, later callers' arguments are ignored while a
 * run is in flight. The promise is forgotten once it settles, so a later call
 * starts a fresh run.
 */
export function singleFlight<A extends unknown[], R>(
	fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
	let inFlight: Promise<R> | undefined;
	return function singleFlightWrapper(...args: A): Promise<R> {
		inFlight ??= fn(...args).finally(() => {
			inFlight = undefined;
		});
		return inFlight;
	};
}
