import { readFile } from "node:fs/promises";
import path from "node:path";

import { extractReleaseNoteItems } from "./track-release.js";

/**
 * Checked-in highlights, one Markdown file per release: `<version>.md`, named
 * for the exact published version. Add the file in the version-bump pull
 * request so the wording is reviewed with the release. Preview versions are
 * stamped at build time, so highlights apply to Stable releases in practice.
 */
export const RELEASE_HIGHLIGHTS_DIRECTORY = path.resolve(
	import.meta.dirname,
	"..",
	"release-highlights",
);

export async function readReleaseHighlights(
	directory: string,
	version: string,
): Promise<string | null> {
	const highlights = await readOptional(path.join(directory, `${version}.md`));
	if (
		highlights === null &&
		(await readOptional(path.join(directory, `v${version}.md`))) !== null
	) {
		// Named after the tag: publishing without the highlights would go unnoticed.
		throw new Error(`Rename release-highlights/v${version}.md to ${version}.md.`);
	}
	return highlights;
}

async function readOptional(file: string): Promise<string | null> {
	try {
		return await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/**
 * Puts hand-written highlights (e.g. a milestone or a change users must know about) ahead of the notes
 * GitHub generates from pull-request titles. The app lists only list items,
 * in order, so highlights must contain at least one to be seen in-app.
 */
export function withReleaseHighlights(bodyMarkdown: string, highlights: string | null): string {
	if (highlights === null) return bodyMarkdown;
	const trimmed = highlights.trim();
	if (extractReleaseNoteItems(trimmed).length === 0) {
		throw new Error("Release highlights must contain at least one list item (`- …`).");
	}
	return ["## Highlights", "", trimmed, "", bodyMarkdown].join("\n");
}
