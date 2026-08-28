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

/**
 * Holds Electron's first quit edge until asynchronous cleanup settles. Normal
 * quits resume through `app.quit`; updater quits retain their initiating action
 * so `quitAndInstall` is retried only after cleanup and can complete installation.
 */
export class AwaitedShutdownBarrier {
	readonly #dispose: () => Promise<void>;
	readonly #quit: () => void;
	readonly #logger: ShutdownLogger;
	#shutdown: Promise<void> | undefined;
	#allowQuit = false;
	#externalQuit: (() => void) | undefined;

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

	requestExternalQuit(quit: () => void): void {
		if (this.#allowQuit) {
			quit();
			return;
		}
		this.#externalQuit = quit;
		try {
			quit();
		} catch (error) {
			this.#externalQuit = undefined;
			throw error;
		}
	}

	async #finishShutdown(): Promise<void> {
		try {
			await this.#dispose();
		} catch (error) {
			this.#logger.error("shutdown cleanup failed", error);
		} finally {
			const quit = this.#externalQuit ?? this.#quit;
			this.#externalQuit = undefined;
			this.#allowQuit = true;
			quit();
		}
	}
}
