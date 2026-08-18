export interface BeforeQuitEvent {
	preventDefault(): void;
}

export interface ShutdownLogger {
	error(message: string, error: unknown): void;
}

export interface AwaitedShutdownOptions {
	readonly dispose: () => Promise<void>;
	readonly quit: () => void;
	readonly logger: ShutdownLogger;
}

/** Holds Electron's first quit edge until asynchronous cleanup settles. */
export class AwaitedShutdownBarrier {
	readonly #dispose: () => Promise<void>;
	readonly #quit: () => void;
	readonly #logger: ShutdownLogger;
	#shutdown: Promise<void> | undefined;
	#allowQuit = false;

	constructor(options: AwaitedShutdownOptions) {
		this.#dispose = options.dispose;
		this.#quit = options.quit;
		this.#logger = options.logger;
	}

	handleBeforeQuit(event: BeforeQuitEvent): Promise<void> | undefined {
		if (this.#allowQuit) return;
		event.preventDefault();
		this.#shutdown ??= this.#finishShutdown();
		return this.#shutdown;
	}

	async #finishShutdown(): Promise<void> {
		try {
			await this.#dispose();
		} catch (error) {
			this.#logger.error("shutdown cleanup failed", error);
		} finally {
			this.#allowQuit = true;
			this.#quit();
		}
	}
}
