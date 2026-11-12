import { valid } from "semver";
import { z } from "zod";

import { RELEASE_TRACKS } from "./release.js";

const trackDownloadManifestEntrySchema = z.object({
	platform: z.enum(["linux", "macos", "windows"]),
	arch: z.string().min(1),
	type: z.enum(["deb", "dmg", "setup", "zip"]),
	fileName: z.string().min(1),
	url: z.string().min(1),
	size: z.number().int().nonnegative(),
	sha256: z.string().min(1),
});

/** The `<channel>/latest.json` pointer published after every track release. */
export const trackReleaseManifestSchema = z.object({
	schemaVersion: z.literal(1),
	track: z.enum(RELEASE_TRACKS),
	version: z.string().refine((version) => valid(version) !== null, "Expected a semver version."),
	publishedAt: z.string().min(1),
	releaseNotesUrl: z.string().min(1),
	downloads: z.array(trackDownloadManifestEntrySchema),
});

export type TrackDownloadManifestEntry = z.infer<typeof trackDownloadManifestEntrySchema>;
export type TrackReleaseManifest = z.infer<typeof trackReleaseManifestSchema>;
