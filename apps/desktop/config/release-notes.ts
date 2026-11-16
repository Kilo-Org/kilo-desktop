import { z } from "zod";

import { RELEASE_TRACKS } from "./release.js";

/** Most items a published release-notes document may carry. */
export const MAX_PUBLISHED_RELEASE_NOTE_ITEMS = 50;

/** The release-notes document published next to each track's update feed. */
export const desktopReleaseNotesSchema = z.object({
	schemaVersion: z.literal(1),
	track: z.enum(RELEASE_TRACKS),
	version: z.string().min(1),
	previousVersion: z.string().min(1).nullable().optional(),
	title: z.string().min(1),
	publishedAt: z.string().min(1),
	bodyMarkdown: z.string(),
	items: z.array(z.string().min(1)).max(MAX_PUBLISHED_RELEASE_NOTE_ITEMS),
});

export type DesktopReleaseNotes = z.infer<typeof desktopReleaseNotesSchema>;
