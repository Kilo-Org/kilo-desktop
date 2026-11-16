import Store from "electron-store";

import { THEME_SOURCES, type ThemeSource } from "@kilo-desktop/ui/themes/theme-tokens";
import { z } from "zod";

import { RELEASE_TRACKS, type ReleaseTrack } from "$config/release.js";

import { DEFAULT_LOG_LEVEL, logLevelSchema, type LogLevel } from "./logger.js";

const themeSourceSchema = z.enum(THEME_SOURCES);
const releaseTrackSchema = z.enum(RELEASE_TRACKS);

export interface AppPreferences {
	/** Last renderer-synced theme source — used to resolve cold-start native chrome. */
	themeSource?: ThemeSource;
	/** Telemetry opt-out gate. Defaults to `true` (opt-out model). */
	allowDataCollection?: boolean;
	/** Stable per-install id, generated once and persisted across sessions. */
	installationId?: string;
	/** User-selected desktop update track; unset follows the build's release track. */
	releaseTrack?: ReleaseTrack;
	/** Main-process log verbosity; unset logs at info. `KILO_LOG_LEVEL` overrides. */
	logLevel?: LogLevel;
}

export interface PreferencesStoreOptions {
	/**
	 * Keeps effective consent off regardless of the saved choice, so a build
	 * (e2e) never emits telemetry while the privacy setting still round-trips.
	 */
	forceDataCollectionOff?: boolean;
}

/**
 * Owns persisted shell preferences; invalid theme values fall back to application
 * defaults. Data collection changes run one at a time in call order: each is saved,
 * then every listener is notified before the next change starts.
 *
 * Data collection has two views: `dataCollectionChoice` is the user's saved
 * setting (what Privacy settings show), and `allowDataCollection` is the
 * effective consent every telemetry sink enforces. They are equal unless the
 * build forces collection off; listeners always receive effective consent.
 */
export class PreferencesStore {
	readonly #store: Store<AppPreferences>;
	readonly #forceDataCollectionOff: boolean;
	readonly #consentListeners = new Set<(allow: boolean) => void | Promise<void>>();
	#consentQueue: Promise<void> = Promise.resolve();

	constructor(
		// config/smoke-release-artifact.ts seeds `preferences.json` / `allowDataCollection`.
		store: Store<AppPreferences> = new Store<AppPreferences>({ name: "preferences" }),
		options: PreferencesStoreOptions = {},
	) {
		this.#store = store;
		this.#forceDataCollectionOff = options.forceDataCollectionOff ?? false;
	}

	get themeSource(): ThemeSource | undefined {
		const parsed = themeSourceSchema.safeParse(this.#store.get("themeSource"));
		return parsed.success ? parsed.data : undefined;
	}

	setThemeSource(source: ThemeSource): void {
		this.#store.set("themeSource", source);
	}

	/** The user's saved data-collection setting. Opt-out model: defaults to `true` when unset. */
	get dataCollectionChoice(): boolean {
		const value = this.#store.get("allowDataCollection");
		return typeof value === "boolean" ? value : true;
	}

	/** Whether telemetry may collect data: the saved choice unless the build forces it off. */
	get allowDataCollection(): boolean {
		return !this.#forceDataCollectionOff && this.dataCollectionChoice;
	}

	setAllowDataCollection(allow: boolean): Promise<void> {
		const change = this.#consentQueue.then(async () => {
			try {
				this.#store.set("allowDataCollection", allow);
			} catch (cause) {
				throw new Error("Could not save data collection preference. Retry the change.", { cause });
			}
			const results = await Promise.allSettled(
				[...this.#consentListeners].map(async (listener) => listener(this.allowDataCollection)),
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
