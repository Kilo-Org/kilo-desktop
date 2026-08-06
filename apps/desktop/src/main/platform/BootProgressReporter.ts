import { createLogger, type Logger } from "./logger.js";

/**
 * Coarse boot phases that the splash window can display.
 * New phases can be added as boot steps grow (e.g. "conda-env-update").
 */
export type BootPhase = "initializing" | "updates" | "features" | "ready";

export interface BootProgressEvent {
	/** Current high-level phase. */
	phase: BootPhase;
	/** Short user-facing message (e.g. "Preparing features…"). */
	message: string;
}

export type BootProgressListener = (event: BootProgressEvent) => void;

/**
 * Shell-side reporter that tracks coarse boot progress.
 *
 * The boot sequence pushes phases into this reporter, and the splash window
 * subscribes to updates. Features do NOT import this — baseline progress comes
 * from the shell iterating the FEATURES array.
 *
 * Design: synchronous, in-memory only. No IPC — the splash window reads state
 * directly from this instance (same process).
 */
export class BootProgressReporter {
	#phase: BootPhase = "initializing";
	#message = "Starting…";
	#listeners = new Set<BootProgressListener>();
	readonly #logger: Logger;

	constructor(logger?: Logger) {
		this.#logger = logger ?? createLogger("boot");
	}

	get phase(): BootPhase {
		return this.#phase;
	}

	get message(): string {
		return this.#message;
	}

	/** Subscribe to progress updates. Returns an unsubscribe function. */
	onProgress(listener: BootProgressListener): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	/** Report a phase transition with a user-facing message. */
	report(phase: BootPhase, message: string): void {
		this.#phase = phase;
		this.#message = message;
		this.#logger.info(`[${phase}] ${message}`);
		for (const listener of this.#listeners) {
			try {
				listener({ phase, message });
			} catch {
				// Listener errors must not abort the boot sequence.
			}
		}
	}

	/** Report per-feature progress during the "features" phase. */
	reportFeature(displayName: string): void {
		this.report("features", `Preparing ${displayName}…`);
	}

	/** Signal that boot is complete. */
	complete(): void {
		this.report("ready", "Ready");
	}

	/** Remove all listeners. */
	dispose(): void {
		this.#listeners.clear();
	}
}
