/**
 * Previews the release notes `publish-track-release.ts` would publish, without
 * creating a release or uploading anything. Uses the GitHub CLI (`gh`) for
 * auth; GitHub's generate-notes endpoint is read-only.
 *
 *   pnpm --filter @kilo-desktop/desktop release:notes v0.1.12
 *   pnpm --filter @kilo-desktop/desktop release:notes v0.1.12 --previous v0.1.10
 *   pnpm --filter @kilo-desktop/desktop release:notes v0.1.13 --target main
 *   pnpm --filter @kilo-desktop/desktop release:notes --body-file notes.md
 *   pnpm --filter @kilo-desktop/desktop release:notes v0.1.12 --json
 *   pnpm --filter @kilo-desktop/desktop release:notes --body-file notes.md --version 1.0.0
 *
 * Highlights from `release-highlights/<version>.md` lead the notes, as they
 * would when publishing; the version comes from the tag unless `--version`
 * names it.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { execa } from "execa";

import {
	readReleaseHighlights,
	RELEASE_HIGHLIGHTS_DIRECTORY,
	withReleaseHighlights,
} from "./release-highlights.js";
import {
	extractReleaseNoteItems,
	findPreviousTrackTag,
	getTrackReleaseVersionFromTag,
	groupGeneratedReleaseNotes,
	sanitizeGeneratedReleaseNotes,
} from "./track-release.js";
import type { ReleaseTrack } from "./release.js";

const USAGE = `Usage: release:notes <tag> [--previous <tag>] [--target <ref>] [--repo <owner/name>] [--version <version>] [--json]
       release:notes --body-file <path> [--version <version>] [--json]`;

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			previous: { type: "string" },
			target: { type: "string" },
			repo: { type: "string" },
			"body-file": { type: "string" },
			version: { type: "string" },
			json: { type: "boolean", default: false },
			help: { type: "boolean", short: "h", default: false },
		},
	});
	const tag = positionals[0];
	if (values.help || (!tag && !values["body-file"])) {
		console.log(USAGE);
		process.exitCode = values.help ? 0 : 1;
		return;
	}

	const rawBody = values["body-file"]
		? await readFile(values["body-file"], "utf8")
		: await generateNotes({
				tag: tag!,
				repo: values.repo ?? (await currentRepository()),
				previous: values.previous,
				target: values.target,
			});

	const version = (values.version ?? tag)?.replace(/^v/, "");
	const bodyMarkdown = withReleaseHighlights(
		sanitizeGeneratedReleaseNotes(groupGeneratedReleaseNotes(rawBody)),
		version ? await readReleaseHighlights(RELEASE_HIGHLIGHTS_DIRECTORY, version) : null,
	);
	const items = extractReleaseNoteItems(bodyMarkdown);

	if (values.json) {
		console.log(JSON.stringify({ bodyMarkdown, items }, null, 2));
		return;
	}
	console.log(bodyMarkdown);
	console.log(`\n---\nIn-app items (${items.length}):`);
	items.forEach((item, index) => {
		console.log(`${String(index + 1).padStart(2)}. ${item}`);
	});
}

async function generateNotes(input: {
	tag: string;
	repo: string;
	previous: string | undefined;
	target: string | undefined;
}): Promise<string> {
	const track = trackForTag(input.tag);
	const previous = input.previous ?? (await previousTag(input.repo, track, input.tag));
	console.error(
		`Generating ${track} notes for ${input.tag} (previous: ${previous ?? "none"}) in ${input.repo}`,
	);
	const fields = [
		["tag_name", input.tag],
		...(previous ? [["previous_tag_name", previous]] : []),
		...(input.target ? [["target_commitish", input.target]] : []),
	].flatMap(([key, value]) => ["-f", `${key}=${value}`]);
	const { stdout } = await execa("gh", [
		"api",
		`repos/${input.repo}/releases/generate-notes`,
		...fields,
		"--jq",
		".body",
	]);
	return stdout;
}

function trackForTag(tag: string): ReleaseTrack {
	return getTrackReleaseVersionFromTag("preview", tag) === null ? "stable" : "preview";
}

async function previousTag(
	repo: string,
	track: ReleaseTrack,
	tag: string,
): Promise<string | undefined> {
	const { stdout } = await execa("gh", [
		"release",
		"list",
		"--repo",
		repo,
		"--limit",
		"1000",
		"--json",
		"tagName",
		"--jq",
		".[].tagName",
	]);
	return findPreviousTrackTag(stdout.split("\n").filter(Boolean), track, tag);
}

async function currentRepository(): Promise<string> {
	const { stdout } = await execa("gh", [
		"repo",
		"view",
		"--json",
		"nameWithOwner",
		"--jq",
		".nameWithOwner",
	]);
	return stdout.trim();
}

await main();
