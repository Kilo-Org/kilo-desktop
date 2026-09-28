import Store from "electron-store";

import {
	normalizeAppThemePreferences,
	releaseTrackSchema,
	themeSourceSchema,
	type ReleaseTrack,
	type ThemeSource,
} from "@kilo-desktop/contracts";

import { DEFAULT_LOG_LEVEL, logLevelSchema, type LogLevel } from "./logger.js";

export interface AppPreferences {
	/** Last renderer-synced theme source — used to resolve cold-start native chrome. */
	themeSource?: ThemeSource;
	themeId?: string;
	/** Telemetry opt-out gate. Defaults to `true` (opt-out model). */
	allowDataCollection?: boolean;
	/** Stable per-install id, generated once and persisted across sessions. */
	installationId?: string;
	/** User-selected desktop update track; unset follows the build's release track. */
	releaseTrack?: ReleaseTrack;
	/** Main-process log verbosity; unset logs at info. `KILO_LOG_LEVEL` overrides. */
	logLevel?: LogLevel;
}

/**
 * Owns persisted shell preferences; invalid theme values fall back to application
 * defaults. Data collection changes run one at a time in call order: each is saved,
 * then every listener is notified before the next change starts.
 */
export class PreferencesStore {
	readonly #store: Store<AppPreferences>;
	readonly #consentListeners = new Set<(allow: boolean) => void | Promise<void>>();
	#consentQueue: Promise<void> = Promise.resolve();

	constructor(store: Store<AppPreferences> = new Store<AppPreferences>({ name: "preferences" })) {
		this.#store = store;
	}

	get themeSource(): ThemeSource | undefined {
		const parsed = themeSourceSchema.safeParse(this.#store.get("themeSource"));
		return parsed.success ? parsed.data : undefined;
	}

	setThemeSource(source: ThemeSource): void {
		this.#store.set("themeSource", source);
	}

	get themeId(): string {
		return normalizeAppThemePreferences({ themeId: this.#store.get("themeId") }).themeId;
	}

	setThemeId(themeId: string): void {
		this.#store.set("themeId", normalizeAppThemePreferences({ themeId }).themeId);
	}

	/** Whether telemetry may collect data. Opt-out model: defaults to `true` when unset. */
	get allowDataCollection(): boolean {
		const value = this.#store.get("allowDataCollection");
		return typeof value === "boolean" ? value : true;
	}

	setAllowDataCollection(allow: boolean): Promise<void> {
		const change = this.#consentQueue.then(async () => {
			try {
				this.#store.set("allowDataCollection", allow);
			} catch (cause) {
				throw new Error("Could not save data collection preference. Retry the change.", { cause });
			}
			const results = await Promise.allSettled(
				[...this.#consentListeners].map(async (listener) => listener(allow)),
			);
			const failures = results.flatMap((result) =>
				result.status === "rejected" ? [result.reason] : [],
			);
			if (failures.length > 0) {
				throw new AggregateError(
					failures,
					"Could not apply data collection preference to all services. Retry the change.",
				);
			}
		});
		this.#consentQueue = change.catch(() => {});
		return change;
	}

	onDidChangeAllowDataCollection(listener: (allow: boolean) => void | Promise<void>): () => void {
		this.#consentListeners.add(listener);
		return () => {
			this.#consentListeners.delete(listener);
		};
	}

	getReleaseTrack(fallback: ReleaseTrack): ReleaseTrack {
		const parsed = releaseTrackSchema.safeParse(this.#store.get("releaseTrack"));
		return parsed.success ? parsed.data : fallback;
	}

	getLogLevel(): LogLevel {
		const parsed = logLevelSchema.safeParse(this.#store.get("logLevel"));
		return parsed.success ? parsed.data : DEFAULT_LOG_LEVEL;
	}

	setLogLevel(level: LogLevel): void {
		this.#store.set("logLevel", logLevelSchema.parse(level));
	}

	setReleaseTrack(track: ReleaseTrack): void {
		this.#store.set("releaseTrack", releaseTrackSchema.parse(track));
	}

	/**
	 * Stable installation id, lazily generated on first read and persisted so it
	 * survives restarts. Used as the anonymous telemetry `distinct_id` and as the
	 * Sentry user id to correlate a single install (e.g. affected-user counts on
	 * issues) without identifying the actual user.
	 */
	getInstallationId(): string {
		let id = this.#store.get("installationId");
		if (typeof id !== "string" || id.length === 0) {
			id = crypto.randomUUID();
			this.#store.set("installationId", id);
		}
		return id;
	}
}
