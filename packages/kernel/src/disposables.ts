export type Disposer = () => void | Promise<void>;

/**
 * Collects disposers for one plugin activation. Disposal runs them in reverse
 * registration order; once disposed the scope refuses new registrations.
 */
export class DisposableScope {
	readonly #disposers: Disposer[] = [];
	#disposed = false;

	get disposed(): boolean {
		return this.#disposed;
	}

	/** Disposers still registered. */
	get size(): number {
		return this.#disposers.length;
	}

	/** Registers a disposer; the returned function runs and forgets it early. */
	add(disposer: Disposer): () => void {
		if (this.#disposed) {
			void disposer();
			return () => {};
		}
		this.#disposers.push(disposer);
		let ran = false;
		return () => {
			if (ran) return;
			ran = true;
			const index = this.#disposers.indexOf(disposer);
			if (index !== -1) this.#disposers.splice(index, 1);
			void disposer();
		};
	}

	async dispose(onError?: (error: unknown) => void): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const disposer of this.#disposers.splice(0).reverse()) {
			try {
				// Disposal is sequential and in reverse registration order: later disposers may depend on earlier ones.
				// react-doctor-disable-next-line react-doctor/async-await-in-loop
				await disposer();
			} catch (error) {
				onError?.(error);
			}
		}
	}
}
