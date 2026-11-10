import { access } from "node:fs/promises";

import type { LlamaRuntimeSource } from "../../contracts";

/** A `kilo.local-inference/llama-runtime` contribution, titled for the logs. */
export interface LlamaRuntimeCandidate extends LlamaRuntimeSource {
	readonly title: string;
}

export interface ResolveLlamaExecutableOptions {
	/** The `llama-runtime` contributions, in priority order. */
	readonly runtimes: readonly LlamaRuntimeCandidate[];
	readonly overridePath?: string;
	readonly accessFile?: (filePath: string) => Promise<void>;
	readonly logger?: { warn(message: string): void };
}

/**
 * `LOCAL_LLAMA_SERVER_PATH` wins; otherwise each runtime is tried in priority
 * order and keeps going when one fails, so a runtime that can't install its
 * build still lets a later one provide a working server.
 */
export async function resolveLlamaExecutable(
	options: ResolveLlamaExecutableOptions,
): Promise<string> {
	const accessFile = options.accessFile ?? access;
	const override = options.overridePath?.trim();
	if (override) {
		await accessFile(override);
		return override;
	}
	if (options.runtimes.length === 0) {
		throw new Error("The local inference runtime is unavailable.");
	}
	let lastError: unknown;
	for (const runtime of options.runtimes) {
		try {
			const executable = await runtime.resolveExecutable();
			await accessFile(executable);
			return executable;
		} catch (error) {
			lastError = error;
			options.logger?.warn(
				`Could not get llama.cpp from ${runtime.title}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error("Local inference could not install llama.cpp.");
}
