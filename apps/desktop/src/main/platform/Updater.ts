import { autoUpdater, type FeedURLOptions } from "electron";

import {
	desktopReleaseNotesSchema,
	type DesktopReleaseNotes,
	type DesktopUpdateActionResult,
	type DesktopUpdateState,
	type ReleaseTrack,
} from "@kilo-desktop/contracts";

import { getReleaseNotesUrl, getUpdateFeedUrl } from "$config/release.js";

const STARTUP_DELAY_MS = 15_000;
const POLL_INTERVAL_MS = 10 * 60_000;
const MAX_RELEASE_NOTES_BYTES = 256 * 1024;
const MAX_RELEASE_NOTE_GROUPS = 6;
const MAX_RELEASE_NOTE_ITEMS = 8;
const MAX_RELEASE_NOTE_ITEM_LENGTH = 220;
const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(["darwin", "win32"]);

interface NativeUpdater {
	setFeedURL(options: FeedURLOptions): void;
	checkForUpdates(): void;
	quitAndInstall(): void;
	on(event: string, listener: (...args: never[]) => void): unknown;
	removeListener(event: string, listener: (...args: never[]) => void): unknown;
}

interface DesktopUpdaterServiceOptions {
	readonly isPackaged: boolean;
	readonly platform: NodeJS.Platform;
	readonly arch: string;
	readonly track: ReleaseTrack;
	readonly currentVersion: string;
	readonly publishUrl: string;
	readonly fetch: typeof globalThis.fetch;
	readonly installWithShutdown: (install: () => void) => void;
	readonly broadcast: (state: DesktopUpdateState) => void;
	readonly persistTrack: (track: ReleaseTrack) => void;
	readonly logger: {
		info(message: string): void;
		warn(message: string, error?: unknown): void;
		error(message: string, error?: unknown): void;
	};
	readonly updater?: NativeUpdater;
}

/**
 * Owns the native updater lifecycle and its renderer-facing state machine.
 * Electron remains the sole source of update truth: renderer actions only ask
 * this service to check, switch tracks, or install, and every native event is
 * reduced here before a validated snapshot is broadcast. Track changes are
 * persisted only when no update payload is active, and feed assignment is
 * rolled back if persistence fails. Release-note network failures are isolated
 * from the binary path so content can never make an update unavailable.
 */
export class DesktopUpdaterService {
	readonly #options: DesktopUpdaterServiceOptions;
	readonly #updater: NativeUpdater;
	readonly #listeners: Array<{ event: string; listener: (...args: never[]) => void }> = [];
	#startupTimer: ReturnType<typeof setTimeout> | undefined;
	#pollTimer: ReturnType<typeof setInterval> | undefined;
	#checkInFlight = false;
	#disposed = false;
	#latestReleaseNotes: DesktopReleaseNotes | null = null;
	#state: DesktopUpdateState;

	constructor(options: DesktopUpdaterServiceOptions) {
		this.#options = options;
		this.#updater = options.updater ?? (autoUpdater as unknown as NativeUpdater);
		const disabledReason = this.#disabledReason();
		this.#state = {
			enabled: disabledReason === null,
			status: disabledReason === null ? "idle" : "disabled",
			track: options.track,
			currentVersion: options.currentVersion,
			availableVersion: null,
			downloadedVersion: null,
			releaseNotes: [],
			checkedAt: null,
			message: disabledReason,
		};
	}

	get state(): DesktopUpdateState {
		return this.#state;
	}

	start(): () => void {
		if (!this.#state.enabled) {
			this.#options.logger.info(this.#state.message ?? "Automatic updates are disabled.");
			return () => this.dispose();
		}

		this.#updater.setFeedURL(this.#feedOptions());
		this.#listen("checking-for-update", () =>
			this.#setState({ status: "checking", message: null }),
		);
		this.#listen("update-available", () => {
			this.#checkInFlight = false;
			this.#setState({
				status: "downloading",
				availableVersion: this.#latestReleaseNotes?.version ?? null,
				message: null,
			});
		});
		this.#listen("update-not-available", () => {
			this.#checkInFlight = false;
			this.#setState({
				status: "up-to-date",
				availableVersion: null,
				downloadedVersion: null,
				releaseNotes: [],
				message: null,
			});
		});
		this.#listen("update-downloaded", (...args: never[]) => {
			void this.#handleDownloaded(args[2] as string | undefined);
		});
		this.#listen("error", (...args: never[]) => {
			this.#handleError(args[0] as Error | undefined);
		});

		this.#startupTimer = setTimeout(() => void this.check(), STARTUP_DELAY_MS);
		this.#pollTimer = setInterval(() => void this.check(), POLL_INTERVAL_MS);
		return () => this.dispose();
	}

	async check(): Promise<DesktopUpdateActionResult> {
		if (
			!this.#state.enabled ||
			this.#disposed ||
			this.#checkInFlight ||
			this.#state.status === "downloading" ||
			this.#state.status === "downloaded"
		) {
			return { accepted: false, state: this.#state };
		}

		this.#checkInFlight = true;
		this.#setState({ status: "checking", checkedAt: new Date().toISOString(), message: null });
		this.#latestReleaseNotes = await this.#fetchReleaseNotes();
		try {
			this.#updater.checkForUpdates();
			return { accepted: true, state: this.#state };
		} catch (error) {
			this.#handleError(error instanceof Error ? error : undefined);
			return { accepted: true, state: this.#state };
		}
	}

	async setTrack(track: ReleaseTrack): Promise<DesktopUpdateActionResult> {
		if (this.#disposed) return { accepted: false, state: this.#state };
		if (track === this.#state.track) return { accepted: false, state: this.#state };
		if (
			this.#checkInFlight ||
			this.#state.status === "checking" ||
			this.#state.status === "downloading" ||
			this.#state.status === "downloaded"
		) {
			return {
				accepted: false,
				state: {
					...this.#state,
					message: "Finish the current update before changing update tracks.",
				},
			};
		}

		const previousTrack = this.#state.track;
		if (this.#state.enabled) this.#updater.setFeedURL(this.#feedOptions(track));
		try {
			this.#options.persistTrack(track);
		} catch (error) {
			if (this.#state.enabled) this.#updater.setFeedURL(this.#feedOptions(previousTrack));
			throw error;
		}

		this.#latestReleaseNotes = null;
		this.#state = {
			...this.#state,
			status: this.#state.enabled ? "idle" : "disabled",
			track,
			availableVersion: null,
			downloadedVersion: null,
			releaseNotes: [],
			checkedAt: null,
			message: this.#state.enabled ? null : this.#disabledReason(),
		};
		this.#options.broadcast(this.#state);
		if (this.#state.enabled) await this.check();
		return { accepted: true, state: this.#state };
	}

	install(): DesktopUpdateActionResult {
		if (!this.#state.enabled || this.#state.status !== "downloaded" || this.#disposed) {
			return { accepted: false, state: this.#state };
		}
		try {
			this.#options.installWithShutdown(() => this.#updater.quitAndInstall());
			return { accepted: true, state: this.#state };
		} catch (error) {
			this.#options.logger.error("Failed to install downloaded update", error);
			this.#setState({ message: "The downloaded update could not be installed. Try again." });
			return { accepted: true, state: this.#state };
		}
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		if (this.#startupTimer) clearTimeout(this.#startupTimer);
		if (this.#pollTimer) clearInterval(this.#pollTimer);
		for (const { event, listener } of this.#listeners.splice(0)) {
			this.#updater.removeListener(event, listener);
		}
	}

	#disabledReason(): string | null {
		if (!this.#options.isPackaged) return "Automatic updates are available in packaged builds.";
		if (!SUPPORTED_PLATFORMS.has(this.#options.platform)) {
			return "Automatic updates are not available on this platform.";
		}
		if (!this.#options.publishUrl) return "Automatic updates are not configured for this build.";
		return null;
	}

	#feedOptions(track: ReleaseTrack = this.#state.track): FeedURLOptions {
		const feedUrl = getUpdateFeedUrl({
			publishUrl: this.#options.publishUrl,
			track,
			platform: this.#options.platform,
			arch: this.#options.arch,
		});
		if (!feedUrl) throw new Error("Update feed URL is unavailable.");
		return this.#options.platform === "darwin"
			? { url: `${feedUrl}/RELEASES.json`, serverType: "json" }
			: { url: feedUrl };
	}

	#listen(event: string, listener: (...args: never[]) => void): void {
		this.#updater.on(event, listener);
		this.#listeners.push({ event, listener });
	}

	#setState(patch: Partial<DesktopUpdateState>): void {
		if (this.#disposed) return;
		this.#state = { ...this.#state, ...patch };
		this.#options.broadcast(this.#state);
	}

	#handleError(error: Error | undefined): void {
		this.#checkInFlight = false;
		const duringDownload = this.#state.status === "downloading";
		this.#options.logger.error("Automatic updater reported an error", error);
		this.#setState({
			status: "error",
			message: duringDownload
				? "The update could not be downloaded. It will be retried automatically."
				: "The update check failed. Try again later.",
		});
	}

	async #handleDownloaded(releaseName: string | undefined): Promise<void> {
		this.#checkInFlight = false;
		const releaseVersion = extractVersion(releaseName);
		const latestReleaseNotesVersion = this.#latestReleaseNotes?.version;
		const version = releaseVersion ?? latestReleaseNotesVersion ?? null;
		let targetReleaseNotes = this.#latestReleaseNotes;
		if (version && targetReleaseNotes?.version !== version) {
			targetReleaseNotes = await this.#fetchReleaseNotes(version);
		}
		const releaseNotes = await this.#fetchReleaseNoteHistory(targetReleaseNotes);
		this.#setState({
			status: "downloaded",
			availableVersion: version,
			downloadedVersion: version,
			releaseNotes,
			message: null,
		});
	}

	async #fetchReleaseNoteHistory(
		target: DesktopReleaseNotes | null,
	): Promise<DesktopReleaseNotes[]> {
		if (!target) return [];
		const releases = [target];
		if (this.#state.track !== "preview") return releases;

		const seen = new Set([target.version]);
		let previousVersion = target.previousVersion;
		while (
			previousVersion &&
			previousVersion !== this.#options.currentVersion &&
			releases.length < MAX_RELEASE_NOTE_GROUPS
		) {
			if (seen.has(previousVersion)) {
				this.#options.logger.warn("Preview release-note history contains a cycle.");
				break;
			}
			seen.add(previousVersion);
			const previous = await this.#fetchReleaseNotes(previousVersion);
			if (!previous) break;
			releases.push(previous);
			previousVersion = previous.previousVersion;
		}
		return releases;
	}

	async #fetchReleaseNotes(version?: string): Promise<DesktopReleaseNotes | null> {
		const url = getReleaseNotesUrl({
			publishUrl: this.#options.publishUrl,
			track: this.#state.track,
			...(version ? { version } : {}),
		});
		if (!url) return null;
		try {
			const response = await this.#options.fetch(url, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(5_000),
			});
			if (!response.ok) throw new Error(`Release notes returned HTTP ${response.status}.`);
			const body = await response.text();
			if (Buffer.byteLength(body, "utf8") > MAX_RELEASE_NOTES_BYTES) {
				throw new Error("Release notes exceeded the size limit.");
			}
			const parsed = desktopReleaseNotesSchema.safeParse(JSON.parse(body));
			if (
				!parsed.success ||
				parsed.data.track !== this.#state.track ||
				(version !== undefined && parsed.data.version !== version)
			) {
				throw new Error("Release notes did not match the expected schema or track.");
			}
			return {
				...parsed.data,
				items: parsed.data.items
					.slice(0, MAX_RELEASE_NOTE_ITEMS)
					.map((item) => truncate(item, MAX_RELEASE_NOTE_ITEM_LENGTH)),
			};
		} catch (error) {
			this.#options.logger.warn("Release notes are unavailable", error);
			return null;
		}
	}
}

function extractVersion(releaseName: string | undefined): string | null {
	if (!releaseName) return null;
	return /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(releaseName)?.[0] ?? null;
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
