import {
	resolveOsxNotarize,
	resolveOsxSign,
	resolveWindowsSigning,
	type SigningEnvironment,
} from "./signing.js";

export const DEFAULT_RELEASE_TRACK = "preview";
export const RELEASE_PREFIX = "kilo-desktop-ci-test";
export const RELEASE_TRACKS = ["preview", "stable"] as const;

/**
 * Values accepted by `RELEASE_TRACK` for packaged builds and publish.
 * Local `pnpm start` / `pnpm dev` is unpackaged development and is not a track value.
 */
export type ReleaseTrack = (typeof RELEASE_TRACKS)[number];
export type UpdateChannel = "preview" | "latest";

export interface ReleaseEnvironment {
	readonly RELEASE_TRACK?: string;
	readonly RELEASE_VERSION?: string;
	readonly UPDATE_PUBLISH_URL?: string;
	readonly UPDATE_PUBLISH_URL_PREVIEW?: string;
	readonly UPDATE_PUBLISH_URL_STABLE?: string;
	readonly UPDATE_S3_BUCKET?: string;
	readonly PREVIEW_BUILD_TIME?: string;
}

export type PublishEnvironment = ReleaseEnvironment & SigningEnvironment;

function isReleaseTrack(track: string): track is ReleaseTrack {
	return (RELEASE_TRACKS as readonly string[]).includes(track);
}

export function getReleaseTrack(environment: ReleaseEnvironment = {}): ReleaseTrack {
	const track = environment.RELEASE_TRACK?.trim() || DEFAULT_RELEASE_TRACK;
	if (!isReleaseTrack(track)) {
		throw new Error(
			`Invalid release track: ${track}. Expected one of: ${RELEASE_TRACKS.join(", ")}`,
		);
	}
	return track;
}

export type UpdatePublishUrls = Readonly<Record<ReleaseTrack, string>>;

function normalizePublishUrl(value: string | undefined): string {
	return value?.trim().replace(/\/+$/, "") ?? "";
}

export function getUpdatePublishUrl(environment: ReleaseEnvironment = {}): string {
	return normalizePublishUrl(environment.UPDATE_PUBLISH_URL);
}

/**
 * Update hosts compiled into the app for runtime track switching. Each track
 * publishes from its own GitHub Environment (and AWS account), so a build must
 * know every track's host, not just the one it was published to. When a
 * per-track host is unset, the build's own track falls back to
 * `UPDATE_PUBLISH_URL` so single-host builds keep updating on their track.
 */
export function getUpdatePublishUrls(
	environment: ReleaseEnvironment,
	buildTrack: ReleaseTrack,
): UpdatePublishUrls {
	const fallback = (track: ReleaseTrack) =>
		track === buildTrack ? getUpdatePublishUrl(environment) : "";
	return {
		preview: normalizePublishUrl(environment.UPDATE_PUBLISH_URL_PREVIEW) || fallback("preview"),
		stable: normalizePublishUrl(environment.UPDATE_PUBLISH_URL_STABLE) || fallback("stable"),
	};
}

export function getUpdateChannel(track: ReleaseTrack): UpdateChannel {
	return track === "stable" ? "latest" : track;
}

export function getPreviewBuildTime(environment: ReleaseEnvironment = {}, now = new Date()): Date {
	const raw = environment.PREVIEW_BUILD_TIME?.trim();
	if (!raw) return now;
	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`Invalid PREVIEW_BUILD_TIME: ${raw}`);
	}
	return parsed;
}

const PREVIEW_PUBLISH_VERSION = /^\d+\.\d+\.\d+-preview-\d{6}-\d{5}$/;
const STABLE_RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function isStableReleaseVersion(version: string): boolean {
	return STABLE_RELEASE_VERSION.test(version);
}

export function getPublishAppVersion(input: {
	readonly version: string;
	readonly track: ReleaseTrack;
	readonly releaseVersion?: string;
	readonly now?: Date;
}): string {
	if (input.track === "stable") {
		const version = input.releaseVersion?.trim();
		if (!version) {
			throw new Error("RELEASE_VERSION is required for Stable builds.");
		}
		if (!isStableReleaseVersion(version)) {
			throw new Error(`Invalid Stable release version: ${version}`);
		}
		return version;
	}
	if (PREVIEW_PUBLISH_VERSION.test(input.version)) {
		return input.version;
	}
	const now = input.now ?? new Date();
	if (Number.isNaN(now.getTime())) {
		throw new Error("Preview build time must be a valid date.");
	}
	return `${nextPatchVersion(input.version)}-preview-${formatPreviewTimestamp(now)}`;
}

export function getNativeAppVersion(version: string): string {
	return parseVersionCore(version);
}

function nextPatchVersion(version: string): string {
	const core = parseVersionCore(version);
	const [major, minor, patch] = core.split(".");
	return `${major}.${minor}.${Number(patch) + 1}`;
}

function parseVersionCore(version: string): string {
	const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)/.exec(version);
	if (!match?.groups) {
		throw new Error(`Invalid app version: ${version}`);
	}
	return `${match.groups.major}.${match.groups.minor}.${match.groups.patch}`;
}

function formatPreviewTimestamp(now: Date): string {
	const year = String(now.getUTCFullYear() % 100).padStart(2, "0");
	const month = String(now.getUTCMonth() + 1).padStart(2, "0");
	const day = String(now.getUTCDate()).padStart(2, "0");
	const time = now.getUTCHours() * 10_000 + now.getUTCMinutes() * 100 + now.getUTCSeconds();
	// Squirrel's legacy NuGet comparator parses a trailing prerelease number as
	// Int32, while its bundled NuGet caps the entire prerelease part at 20
	// characters. Preview uses ten-second resolution to keep the full track
	// name while satisfying both constraints.
	return `${year}${month}${day}-${String(time).padStart(6, "0").slice(0, 5)}`;
}

export function getReleasePrefix(track: ReleaseTrack): string {
	return `${RELEASE_PREFIX}/${getUpdateChannel(track)}`;
}

export function getArtifactKey(input: {
	readonly track: ReleaseTrack;
	readonly platform: string;
	readonly arch: string;
	readonly fileName: string;
}): string {
	return `${getReleasePrefix(input.track)}/${input.platform}/${input.arch}/${input.fileName}`;
}

export function getUpdateFeedUrl(input: {
	readonly publishUrl: string;
	readonly track: ReleaseTrack;
	readonly platform: string;
	readonly arch: string;
}): string | undefined {
	if (!input.publishUrl) return undefined;
	const url = new URL(input.publishUrl);
	if (url.protocol !== "https:") {
		throw new Error("UPDATE_PUBLISH_URL must use HTTPS.");
	}
	return `${url.toString().replace(/\/+$/, "")}/${getReleasePrefix(input.track)}/${input.platform}/${input.arch}`;
}

export function getReleaseNotesUrl(input: {
	readonly publishUrl: string;
	readonly track: ReleaseTrack;
	readonly version?: string;
}): string | undefined {
	if (!input.publishUrl) return undefined;
	const url = new URL(input.publishUrl);
	if (url.protocol !== "https:") {
		throw new Error("UPDATE_PUBLISH_URL must use HTTPS.");
	}
	const fileName = input.version ? `${encodeURIComponent(input.version)}.json` : "latest.json";
	return `${url.toString().replace(/\/+$/, "")}/${getReleasePrefix(input.track)}/release-notes/${fileName}`;
}

export function validatePublishEnvironment(
	environment: PublishEnvironment,
	platform: NodeJS.Platform,
): void {
	if (!environment.UPDATE_S3_BUCKET?.trim()) {
		throw new Error("UPDATE_S3_BUCKET is required to publish releases.");
	}

	getReleaseTrack(environment);

	if (platform === "darwin" && !(resolveOsxSign(environment) && resolveOsxNotarize(environment))) {
		throw new Error(
			"Preview/Stable macOS publishing requires a signing identity and notarization credentials (App Store Connect API key or Apple ID).",
		);
	}
	if (platform === "win32" && resolveWindowsSigning(environment).mode === "none") {
		throw new Error(
			"Preview/Stable Windows publishing requires Azure Key Vault signing credentials or a certificate file.",
		);
	}
}
