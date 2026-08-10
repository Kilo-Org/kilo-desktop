import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk";

import type { AnacondaMcpServiceOptions } from "./AnacondaMcpService.js";

const SETTINGS_FILENAME = "settings.json";

interface PersistedSettings {
	enabled: boolean;
	urlOverride: string | null;
}

/**
 * Simple file-backed store for anaconda-mcp settings.
 *
 * Reads once at startup, writes on every mutation, and coalesces concurrent
 * writes so the latest state always wins. Not concurrency-safe across
 * processes, but the feature is single-process so this is sufficient.
 */
export class SettingsStore {
	readonly #path: string;
	readonly #logger: MainSdkLogger;
	#current: PersistedSettings;
	#writeInFlight: Promise<void> = Promise.resolve();
	#pendingWrite: PersistedSettings | undefined;

	private constructor(filePath: string, initial: PersistedSettings, logger: MainSdkLogger) {
		this.#path = filePath;
		this.#current = initial;
		this.#logger = logger;
	}

	/**
	 * Load the persisted settings from `<storageDir>/settings.json`.
	 * Returns defaults if the file doesn't exist or is unreadable.
	 */
	static async load(
		storageDir: string,
		defaults: PersistedSettings,
		logger: MainSdkLogger,
	): Promise<SettingsStore> {
		const filePath = path.join(storageDir, SETTINGS_FILENAME);
		let initial: PersistedSettings = defaults;
		try {
			const content = await readFile(filePath, "utf-8");
			const parsed: unknown = JSON.parse(content);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				const record = parsed as Record<string, unknown>;
				initial = {
					enabled: typeof record.enabled === "boolean" ? record.enabled : defaults.enabled,
					urlOverride:
						typeof record.urlOverride === "string" || record.urlOverride === null
							? (record.urlOverride as string | null)
							: defaults.urlOverride,
				};
			}
		} catch (error: unknown) {
			// ENOENT is expected on first boot; malformed JSON falls back to defaults.
			if (isNodeError(error) && error.code !== "ENOENT") {
				logger.warn(
					`anaconda-mcp: failed to read settings, using defaults: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
		return new SettingsStore(filePath, initial, logger);
	}

	get(): AnacondaMcpServiceOptions {
		return { ...this.#current };
	}

	/**
	 * Merge a partial update into settings and persist.
	 * Returns the new settings snapshot after the write completes.
	 *
	 * Rejects when the on-disk write fails so the caller (contract handler,
	 * UI) can surface the error instead of the user believing their change
	 * was saved. The internal write chain (`#writeInFlight`) keeps a
	 * swallow-then-log fallback so a single failure does not poison
	 * subsequent `set()` calls — but each caller's returned promise still
	 * reflects the outcome of its own write attempt.
	 */
	async set(patch: {
		enabled?: boolean | undefined;
		urlOverride?: string | null | undefined;
	}): Promise<AnacondaMcpServiceOptions> {
		const next: PersistedSettings = {
			enabled: patch.enabled ?? this.#current.enabled,
			urlOverride: patch.urlOverride ?? this.#current.urlOverride,
		};
		// If the caller explicitly passes urlOverride: null, honor it (?? would fall through to current).
		if (patch.urlOverride === null) next.urlOverride = null;
		this.#current = next;
		this.#pendingWrite = next;
		// Chain writes so at most one is in flight; later calls collapse into the latest.
		const writeAttempt = this.#writeInFlight.then(async () => {
			const toWrite = this.#pendingWrite;
			if (!toWrite) return;
			this.#pendingWrite = undefined;
			await mkdir(path.dirname(this.#path), { recursive: true });
			await writeFile(this.#path, JSON.stringify(toWrite, null, "\t") + "\n", "utf-8");
		});
		// Keep the chain healthy so a rejection here does not poison later
		// `set()` calls. The rejection is still surfaced to THIS caller via
		// the `await` below.
		this.#writeInFlight = writeAttempt.catch((error: unknown) => {
			this.#logger.warn(
				`anaconda-mcp: failed to persist settings: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		});
		await writeAttempt;
		return { ...next };
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
