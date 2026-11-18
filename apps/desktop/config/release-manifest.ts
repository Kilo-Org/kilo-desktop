import { valid } from "semver";
import { z } from "zod";

import { RELEASE_TRACKS } from "./release.js";

const DOWNLOAD_PLATFORMS = ["linux", "macos", "windows"] as const;
const DOWNLOAD_TYPES = ["deb", "dmg", "rpm", "setup", "zip"] as const;

const downloadEntrySchema = z.object({
	platform: z.enum(DOWNLOAD_PLATFORMS),
	arch: z.string().min(1),
	type: z.enum(DOWNLOAD_TYPES),
	fileName: z.string().min(1),
	url: z.string().min(1),
	size: z.number().int().nonnegative(),
	sha256: z.string().min(1),
});

export type TrackDownloadManifestEntry = z.infer<typeof downloadEntrySchema>;

function isKnownDownload(entry: { platform: string; type: string }): boolean {
	return (
		(DOWNLOAD_PLATFORMS as readonly string[]).includes(entry.platform) &&
		(DOWNLOAD_TYPES as readonly string[]).includes(entry.type)
	);
}

/**
 * Skips entries for a platform or type this client doesn't know, so a later
 * release can list new formats in either array without failing this client's
 * update check. Entries this client does know must still be complete.
 */
const downloadListSchema = z
	.array(
		z.union([
			downloadEntrySchema,
			z
				.object({ platform: z.string(), type: z.string() })
				.refine((entry) => !isKnownDownload(entry), "Malformed download entry."),
		]),
	)
	.transform((entries) =>
		entries.filter((entry): entry is TrackDownloadManifestEntry => isKnownDownload(entry)),
	);

/** The `<channel>/latest.json` pointer published after every track release. */
export const trackReleaseManifestSchema = z.object({
	schemaVersion: z.literal(1),
	track: z.enum(RELEASE_TRACKS),
	version: z.string().refine((version) => valid(version) !== null, "Expected a semver version."),
	publishedAt: z.string().min(1),
	releaseNotesUrl: z.string().min(1),
	downloads: downloadListSchema,
	/** RPMs, kept out of `downloads` for clients that predate them (see publish-track-release.ts). */
	additionalDownloads: downloadListSchema.default([]),
});

export type TrackReleaseManifest = z.infer<typeof trackReleaseManifestSchema>;
