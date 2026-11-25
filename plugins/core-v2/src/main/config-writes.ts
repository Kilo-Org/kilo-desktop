/**
 * Serialises every write Desktop makes to its Kilo v2 global config file
 * (`kilo2.jsonc` in `KILO2_CONFIG_DIR`). Two writers share that file:
 * `KiloConfigManager`, which edits it directly (it must, before the server
 * runs), and the `kilocode.settings` RPC (models' providers, work-style
 * permissions), which the server applies as its own read-modify-write. Each
 * writer reads the file, edits it and writes it back, so two overlapping
 * writes lose one of them; running every write through one queue keeps them
 * apart. There is one such file per process, so production shares one queue
 * (`kiloConfigWrites`); tests may make their own.
 */
export class ConfigWriteQueue {
	#pending: Promise<void> = Promise.resolve();

	/** Runs `write` once every write queued before it settled; a failure doesn't stop the next. */
	run<T>(write: () => Promise<T>): Promise<T> {
		const result = this.#pending.then(write, write);
		this.#pending = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}

export const kiloConfigWrites = new ConfigWriteQueue();
