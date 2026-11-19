import { autoUpdater, type FeedURLOptions } from "electron";
import { gt } from "semver";

import type { LinuxPackageFormat } from "$config/linux-package.js";
import {
	getReleaseNotesUrl,
	getTrackManifestUrl,
	getUpdateFeedUrl,
	type ReleaseTrack,
	type UpdatePublishUrls,
} from "$config/release.js";
import { trackReleaseManifestSchema } from "$config/release-manifest.js";
import { desktopReleaseNotesSchema, type DesktopReleaseNotes } from "$config/release-notes.js";

import { UpdateFeedError, type WindowsUpdateFeed } from "./WindowsUpdateFeed.js";

const STARTUP_DELAY_MS = 15_000;
const POLL_INTERVAL_MS = 10 * 60_000;
const RELEASE_NOTES_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000] as const;
const MAX_DOCUMENT_BYTES = 256 * 1024;
const MAX_RELEASE_NOTE_GROUPS = 6;
const MAX_RELEASE_NOTE_ITEM_LENGTH = 220;
const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(["darwin", "win32", "linux"]);
/** Platforms the app can't update itself on: it only checks and links the package. */
const MANUAL_UPDATE_PLATFORMS = new Set<NodeJS.Platform>(["linux"]);

/** The updater's state, published to plugins as `kernel/updater`. */
export interface DesktopUpdateState {
	readonly enabled: boolean;
	readonly status:
		| "disabled"
		| "idle"
		| "checking"
		| "downloading"
		| "downloaded"
		| "available"
		| "up-to-date"
		| "error";
	readonly track: ReleaseTrack;
	readonly currentVersion: string;
	readonly availableVersion: string | null;
	readonly downloadedVersion: string | null;
	readonly downloadUrl: string | null;
	readonly releaseNotes: readonly DesktopReleaseNotes[];
	readonly checkedAt: string | null;
	readonly message: string | null;
}

export interface DesktopUpdateActionResult {
	readonly accepted: boolean;
	readonly state: DesktopUpdateState;
}

type ManualRelease =
	| { readonly kind: "current" }
	| { readonly kind: "no-package"; readonly version: string }
	| { readonly kind: "available"; readonly version: string; readonly downloadUrl: string };

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
	readonly publishUrls: UpdatePublishUrls;
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
	/** Windows only: local mirror that Squirrel installs from instead of the remote feed. */
	readonly windowsFeed?: Pick<WindowsUpdateFeed, "directory" | "prepare" | "clear">;
	/** Linux only: the package format that installed this app; defaults to `deb`. */
	readonly linuxPackageFormat?: LinuxPackageFormat;
}

/**
 * Owns the native updater lifecycle and its renderer-facing state machine.
 * Electron remains the sole source of update truth: renderer actions only ask
 * this service to check, switch tracks, or install, and every native event is
 * reduced here before a validated snapshot is broadcast. Track changes are
 * persisted only when no update payload is active, and feed assignment is
 * rolled back if persistence fails. Each track has its own update host (tracks
 * publish from separate environments), so switching tracks repoints both the
 * host and the channel path; a track whose host this build lacks is refused.
 * Release-note network failures are isolated from the binary path so content
 * can never make an update unavailable.
 *
 * On Windows the service downloads the package itself (via `windowsFeed`,
 * over Electron's `net` stack) and points Squirrel at the local mirror, because
 * Squirrel's own HTTP client is rejected by the CDN. The mirror is prepared
 * inside `check()`, so a newer release reaches "downloading" before Squirrel
 * runs, and an up-to-date result never invokes Squirrel at all.
 *
 * On Linux the system package manager owns the install, so the native updater
 * is never touched and nothing is downloaded or installed in-app. A check reads
 * the track's `latest.json` manifest and, when it names a newer version with a
 * package in the installed format (DEB or RPM) for this architecture on the
 * track's own update host, reports
 * `available` with that package's URL for the person to download. A newer
 * release without such a package is reported as an error, not "up to date".
 * Once an update is available, background polls stay quiet: they don't flash
 * `checking`, don't drop the offer when a poll fails or the next release has
 * no package yet, and reuse the release notes while the version is unchanged.
 * A track change abandons a background poll (aborting its requests and
 * ignoring its result) instead of being refused while it runs.
 */
export class DesktopUpdaterService {
	readonly #options: DesktopUpdaterServiceOptions;
	readonly #manual: boolean;
	readonly #updater: NativeUpdater;
	readonly #windowsFeed: DesktopUpdaterServiceOptions["windowsFeed"];
	readonly #feedAbort = new AbortController();
	readonly #listeners: Array<{ event: string; listener: (...args: never[]) => void }> = [];
	#startupTimer: ReturnType<typeof setTimeout> | undefined;
	#pollTimer: ReturnType<typeof setInterval> | undefined;
	#releaseNotesRetryTimer: ReturnType<typeof setTimeout> | undefined;
	#checkInFlight = false;
	/** The running Linux check; replaced or cleared to abandon it. */
	#manualCheck: { readonly abort: AbortController; readonly background: boolean } | null = null;
	#disposed = false;
	#latestReleaseNotes: DesktopReleaseNotes | null = null;
	#state: DesktopUpdateState;

	constructor(options: DesktopUpdaterServiceOptions) {
		this.#options = options;
		this.#manual = MANUAL_UPDATE_PLATFORMS.has(options.platform);
		this.#updater = options.updater ?? (autoUpdater as unknown as NativeUpdater);
		this.#windowsFeed = options.platform === "win32" ? options.windowsFeed : undefined;
		const disabledReason = this.#disabledReason(options.track);
		this.#state = {
			enabled: disabledReason === null,
			status: disabledReason === null ? "idle" : "disabled",
			track: options.track,
			currentVersion: options.currentVersion,
			availableVersion: null,
			downloadedVersion: null,
			downloadUrl: null,
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
			this.#options.logger.info(this.#state.message ?? "Updates are disabled.");
			return () => this.dispose();
		}

		if (!this.#manual) this.#listenToNativeUpdater();
		this.#startupTimer = setTimeout(() => void this.check(), STARTUP_DELAY_MS);
		this.#pollTimer = setInterval(() => void this.check(), POLL_INTERVAL_MS);
		return () => this.dispose();
	}

	#listenToNativeUpdater(): void {
		this.#updater.setFeedURL(this.#feedOptions());
		this.#listen("checking-for-update", () => {
			if (this.#state.status !== "downloading") {
				this.#setState({ status: "checking", message: null });
			}
		});
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
		if (this.#manual) return this.#checkManually();

		this.#checkInFlight = true;
		this.#setState({ status: "checking", checkedAt: new Date().toISOString(), message: null });
		this.#latestReleaseNotes = await this.#fetchReleaseNotes();
		try {
			if (this.#windowsFeed && !(await this.#prepareWindowsFeed(this.#windowsFeed))) {
				return { accepted: true, state: this.#state };
			}
			this.#updater.checkForUpdates();
			return { accepted: true, state: this.#state };
		} catch (error) {
			this.#handleError(error instanceof Error ? error : undefined);
			return { accepted: true, state: this.#state };
		}
	}

	async #checkManually(): Promise<DesktopUpdateActionResult> {
		const background = this.#state.status === "available";
		const check = new AbortController();
		this.#manualCheck = { abort: check, background };
		this.#checkInFlight = true;
		const isCurrent = () => this.#manualCheck?.abort === check && !this.#disposed;
		if (!background) {
			this.#setState({ status: "checking", checkedAt: new Date().toISOString(), message: null });
		}
		try {
			const result = await this.#fetchManualRelease(check.signal);
			if (!isCurrent()) return { accepted: true, state: this.#state };
			if (result.kind === "available") {
				const releaseNotes = await this.#releaseNotesFor(result.version, check.signal);
				if (!isCurrent()) return { accepted: true, state: this.#state };
				this.#setState({
					status: "available",
					availableVersion: result.version,
					downloadUrl: result.downloadUrl,
					releaseNotes,
					checkedAt: new Date().toISOString(),
					message: null,
				});
			} else if (background && result.kind === "no-package") {
				// The offer on screen is still a valid download; a newer release
				// whose Linux package hasn't been published yet doesn't undo it.
				this.#options.logger.warn(
					`Keeping the offered update: ${result.version} has no Linux package for ${this.#options.arch}.`,
				);
			} else {
				this.#setState({
					status: result.kind === "current" ? "up-to-date" : "error",
					availableVersion: null,
					downloadUrl: null,
					releaseNotes: [],
					checkedAt: new Date().toISOString(),
					message:
						result.kind === "current"
							? null
							: `Version ${result.version} has no Linux package for ${this.#options.arch} yet. Try again later.`,
				});
			}
		} catch (error) {
			if (!isCurrent()) return { accepted: true, state: this.#state };
			if (background) {
				this.#options.logger.warn("Background update check failed", error);
			} else {
				this.#handleError(error instanceof Error ? error : undefined);
			}
		} finally {
			if (this.#manualCheck?.abort === check) {
				this.#manualCheck = null;
				this.#checkInFlight = false;
			}
		}
		return { accepted: true, state: this.#state };
	}

	/** Abandons a quiet re-check of an offered update, so a track change can go ahead. */
	#cancelBackgroundCheck(): void {
		if (!this.#manualCheck?.background) return;
		this.#manualCheck.abort.abort();
		this.#manualCheck = null;
		this.#checkInFlight = false;
	}

	/** Release notes for an offered version, reusing the ones already shown for it. */
	async #releaseNotesFor(version: string, signal: AbortSignal): Promise<DesktopReleaseNotes[]> {
		if (version === this.#state.availableVersion && this.#state.releaseNotes.length > 0) {
			return [...this.#state.releaseNotes];
		}
		const target = await this.#fetchReleaseNotes(version, signal);
		return this.#fetchReleaseNoteHistory(target, signal);
	}

	/** What the track's manifest offers this installation. */
	async #fetchManualRelease(signal: AbortSignal): Promise<ManualRelease> {
		const track = this.#state.track;
		const publishUrl = this.#options.publishUrls[track];
		const manifestUrl = getTrackManifestUrl({ publishUrl, track });
		if (!manifestUrl) throw new Error("Update manifest URL is unavailable.");
		const parsed = trackReleaseManifestSchema.safeParse(
			await this.#fetchDocument(manifestUrl, signal),
		);
		if (!parsed.success || parsed.data.track !== track) {
			throw new Error("Update manifest did not match the expected schema or track.");
		}
		const manifest = parsed.data;
		if (!gt(manifest.version, this.#options.currentVersion)) return { kind: "current" };

		const updateHost = new URL(publishUrl).origin;
		const packageFormat = this.#options.linuxPackageFormat ?? "deb";
		const download = [...manifest.downloads, ...manifest.additionalDownloads].find(
			(entry) =>
				entry.platform === "linux" &&
				entry.type === packageFormat &&
				entry.arch === this.#options.arch &&
				isHostedAt(entry.url, updateHost),
		);
		if (!download) return { kind: "no-package", version: manifest.version };
		return { kind: "available", version: manifest.version, downloadUrl: download.url };
	}

	/** Returns whether Squirrel should run against the prepared local mirror. */
	async #prepareWindowsFeed(
		feed: NonNullable<DesktopUpdaterServiceOptions["windowsFeed"]>,
	): Promise<boolean> {
		const prepared = await feed.prepare({
			remoteFeedUrl: this.#remoteFeedUrl(),
			currentVersion: this.#options.currentVersion,
			signal: this.#feedAbort.signal,
			onDownloadStart: (version) =>
				this.#setState({ status: "downloading", availableVersion: version, message: null }),
		});
		if (this.#disposed) return false;
		if (prepared.kind === "ready") return true;
		this.#checkInFlight = false;
		this.#setState({
			status: "up-to-date",
			availableVersion: null,
			downloadedVersion: null,
			releaseNotes: [],
			message: null,
		});
		return false;
	}

	async setTrack(track: ReleaseTrack): Promise<DesktopUpdateActionResult> {
		if (this.#disposed) return { accepted: false, state: this.#state };
		if (track === this.#state.track) return { accepted: false, state: this.#state };
		this.#cancelBackgroundCheck();
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
		if (this.#state.enabled && !this.#options.publishUrls[track]) {
			return {
				accepted: false,
				state: { ...this.#state, message: unconfiguredTrackMessage(track) },
			};
		}

		const previousTrack = this.#state.track;
		const usesNativeFeed = this.#state.enabled && !this.#manual;
		if (usesNativeFeed) this.#updater.setFeedURL(this.#feedOptions(track));
		try {
			this.#options.persistTrack(track);
		} catch (error) {
			if (usesNativeFeed) this.#updater.setFeedURL(this.#feedOptions(previousTrack));
			throw error;
		}

		this.#latestReleaseNotes = null;
		this.#state = {
			...this.#state,
			status: this.#state.enabled ? "idle" : "disabled",
			track,
			availableVersion: null,
			downloadedVersion: null,
			downloadUrl: null,
			releaseNotes: [],
			checkedAt: null,
			message: this.#state.enabled ? null : this.#disabledReason(track),
		};
		this.#options.broadcast(this.#state);
		if (this.#state.enabled) await this.check();
		return { accepted: true, state: this.#state };
	}

	install(): DesktopUpdateActionResult {
		if (
			this.#manual ||
			!this.#state.enabled ||
			this.#state.status !== "downloaded" ||
			this.#disposed
		) {
			return { accepted: false, state: this.#state };
		}
		try {
			this.#options.installWithShutdown(() => this.#updater.quitAndInstall());
			this.#clearReleaseNotesRetry();
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
		this.#feedAbort.abort();
		if (this.#startupTimer) clearTimeout(this.#startupTimer);
		if (this.#pollTimer) clearInterval(this.#pollTimer);
		this.#clearReleaseNotesRetry();
		for (const { event, listener } of this.#listeners.splice(0)) {
			this.#updater.removeListener(event, listener);
		}
	}

	#disabledReason(track: ReleaseTrack): string | null {
		if (!this.#options.isPackaged) return "Update checks run only in packaged builds.";
		if (!SUPPORTED_PLATFORMS.has(this.#options.platform)) {
			return "Updates are not available on this platform.";
		}
		if (!this.#options.publishUrls[track]) return unconfiguredTrackMessage(track);
		return null;
	}

	#remoteFeedUrl(track: ReleaseTrack = this.#state.track): string {
		const feedUrl = getUpdateFeedUrl({
			publishUrl: this.#options.publishUrls[track],
			track,
			platform: this.#options.platform,
			arch: this.#options.arch,
		});
		if (!feedUrl) throw new Error("Update feed URL is unavailable.");
		return feedUrl;
	}

	#feedOptions(track: ReleaseTrack = this.#state.track): FeedURLOptions {
		const feedUrl = this.#remoteFeedUrl(track);
		if (this.#options.platform === "darwin") {
			return { url: `${feedUrl}/RELEASES.json`, serverType: "json" };
		}
		return { url: this.#windowsFeed?.directory ?? feedUrl };
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
		this.#options.logger.error("Updater reported an error", error);
		const httpDetail =
			error instanceof UpdateFeedError && error.status !== undefined
				? ` The update server responded with HTTP ${error.status}.`
				: "";
		this.#setState({
			status: "error",
			message: duringDownload
				? `The update could not be downloaded.${httpDetail} It will be retried automatically.`
				: `The update check failed.${httpDetail} Try again later.`,
		});
	}

	async #handleDownloaded(releaseName: string | undefined): Promise<void> {
		this.#clearReleaseNotesRetry();
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
		if (version && releaseNotes.length === 0) this.#scheduleReleaseNotesRetry(version, 0);
		// Squirrel has copied the package into its own store by now.
		await this.#windowsFeed
			?.clear()
			.catch((error: unknown) =>
				this.#options.logger.warn("Failed to remove the local update mirror", error),
			);
	}

	#scheduleReleaseNotesRetry(version: string, attempt: number): void {
		const delay =
			RELEASE_NOTES_RETRY_DELAYS_MS[Math.min(attempt, RELEASE_NOTES_RETRY_DELAYS_MS.length - 1)];
		if (this.#disposed) return;
		this.#releaseNotesRetryTimer = setTimeout(() => {
			this.#releaseNotesRetryTimer = undefined;
			void this.#retryReleaseNotes(version, attempt);
		}, delay);
	}

	async #retryReleaseNotes(version: string, attempt: number): Promise<void> {
		if (
			this.#disposed ||
			this.#state.status !== "downloaded" ||
			this.#state.downloadedVersion !== version
		) {
			return;
		}
		const target = await this.#fetchReleaseNotes(version);
		if (!target) {
			this.#scheduleReleaseNotesRetry(version, attempt + 1);
			return;
		}
		this.#latestReleaseNotes = target;
		const releaseNotes = await this.#fetchReleaseNoteHistory(target);
		if (
			!this.#disposed &&
			this.#state.status === "downloaded" &&
			this.#state.downloadedVersion === version
		) {
			this.#setState({ releaseNotes });
		}
	}

	#clearReleaseNotesRetry(): void {
		if (!this.#releaseNotesRetryTimer) return;
		clearTimeout(this.#releaseNotesRetryTimer);
		this.#releaseNotesRetryTimer = undefined;
	}

	async #fetchReleaseNoteHistory(
		target: DesktopReleaseNotes | null,
		signal?: AbortSignal,
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
			const previous = await this.#fetchReleaseNotes(previousVersion, signal);
			if (!previous) break;
			releases.push(previous);
			previousVersion = previous.previousVersion;
		}
		return releases;
	}

	async #fetchReleaseNotes(
		version?: string,
		signal?: AbortSignal,
	): Promise<DesktopReleaseNotes | null> {
		const url = getReleaseNotesUrl({
			publishUrl: this.#options.publishUrls[this.#state.track],
			track: this.#state.track,
			...(version ? { version } : {}),
		});
		if (!url) return null;
		try {
			const parsed = desktopReleaseNotesSchema.safeParse(await this.#fetchDocument(url, signal));
			if (
				!parsed.success ||
				parsed.data.track !== this.#state.track ||
				(version !== undefined && parsed.data.version !== version)
			) {
				throw new Error("Release notes did not match the expected schema or track.");
			}
			return {
				...parsed.data,
				items: parsed.data.items.map((item) => truncate(item, MAX_RELEASE_NOTE_ITEM_LENGTH)),
			};
		} catch (error) {
			this.#options.logger.warn("Release notes are unavailable", error);
			return null;
		}
	}

	/**
	 * A small JSON document from the update host, parsed but not yet validated.
	 * Gives up after five seconds, on dispose, or when `signal` aborts.
	 */
	async #fetchDocument(url: string, signal?: AbortSignal): Promise<unknown> {
		const response = await this.#options.fetch(url, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.any([
				AbortSignal.timeout(5_000),
				this.#feedAbort.signal,
				...(signal ? [signal] : []),
			]),
		});
		if (!response.ok) {
			throw new UpdateFeedError(`${url} returned HTTP ${response.status}.`, response.status);
		}
		const body = await response.text();
		if (Buffer.byteLength(body, "utf8") > MAX_DOCUMENT_BYTES) {
			throw new Error(`${url} exceeded the size limit.`);
		}
		return JSON.parse(body);
	}
}

function isHostedAt(url: string, origin: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" && parsed.origin === origin;
	} catch {
		return false;
	}
}

function unconfiguredTrackMessage(track: ReleaseTrack): string {
	const name = track === "stable" ? "Stable" : "Preview";
	return `${name} updates are not configured for this build.`;
}

function extractVersion(releaseName: string | undefined): string | null {
	if (!releaseName) return null;
	return /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(releaseName)?.[0] ?? null;
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}
