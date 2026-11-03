/**
 * A helper to prevent accumulation of sequential async tasks.
 *
 * Imagine a mail man with the sole task of delivering letters. As soon as
 * a letter submitted for delivery, he drives to the destination, delivers it
 * and returns to his base. Imagine that during the trip, N more letters were
 * submitted. When the mail man returns, he picks those N letters and delivers
 * them all in a single trip. Even though N+1 submissions occurred, only 2
 * deliveries were made.
 *
 * The throttler implements this via the queue() method, by providing it a task
 * factory. Following the example:
 *
 * 		const throttler = new Throttler();
 * 		const letters = [];
 *
 * 		function deliver() {
 * 			const lettersToDeliver = letters;
 * 			letters = [];
 * 			return makeTheTrip(lettersToDeliver);
 * 		}
 *
 * 		function onLetterReceived(l) {
 * 			letters.push(l);
 * 			throttler.queue(deliver);
 * 		}
 *
 * Ported from VS Code's `vs/base/common/async.ts` `Throttler`, with its
 * `CancellationTokenSource`/`CancellationToken` pair collapsed into a single
 * `AbortController` (`dispose()` aborts). Callers must pass their tasks'
 * rejections to their own catch — a rejected queued follow-up leaves its
 * callers unsettled (upstream behavior).
 */
export class Throttler {
	private activePromise: Promise<unknown> | null = null;
	private queuedPromise: Promise<unknown> | null = null;
	private queuedPromiseFactory: ((signal: AbortSignal) => Promise<unknown>) | null = null;
	private readonly controller = new AbortController();

	queue<T>(factory: (signal: AbortSignal) => Promise<T>): Promise<T> {
		if (this.controller.signal.aborted) {
			return Promise.reject(new Error("Throttler is disposed"));
		}

		if (this.activePromise) {
			this.queuedPromiseFactory = factory;

			if (!this.queuedPromise) {
				const onComplete = () => {
					this.queuedPromise = null;

					if (this.controller.signal.aborted) {
						return;
					}

					const result = this.queue(this.queuedPromiseFactory!);
					this.queuedPromiseFactory = null;

					return result;
				};

				this.queuedPromise = new Promise((resolve) => {
					this.activePromise!.then(onComplete, onComplete).then(resolve);
				});
			}

			return new Promise<T>((resolve, reject) => {
				this.queuedPromise!.then(
					(result) => resolve(result as T),
					(err: unknown) => reject(err),
				);
			});
		}

		const promise: Promise<unknown> = factory(this.controller.signal);
		this.activePromise = promise;

		return new Promise<T>((resolve, reject) => {
			promise.then(
				(result) => {
					this.activePromise = null;
					resolve(result as T);
				},
				(err: unknown) => {
					this.activePromise = null;
					reject(err);
				},
			);
		});
	}

	dispose(): void {
		this.controller.abort();
	}
}
