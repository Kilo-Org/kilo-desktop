import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readReleaseHighlights, withReleaseHighlights } from "./release-highlights.js";
import { extractReleaseNoteItems } from "./track-release.js";

const generated = [
	"## What's Changed",
	"",
	"### Features",
	"* feat(shell): reveal the app log",
	"",
	"**Full Changelog**: https://github.com/acme/app/compare/v1...v2",
].join("\n");

describe("release highlights", () => {
	it("leads the published notes and the in-app items with the highlights", () => {
		const body = withReleaseHighlights(
			generated,
			"- Workspaces now sync across devices.\n- Read the guide at example.com/sync.\n",
		);

		expect(body).toBe(
			[
				"## Highlights",
				"",
				"- Workspaces now sync across devices.",
				"- Read the guide at example.com/sync.",
				"",
				generated,
			].join("\n"),
		);
		expect(extractReleaseNoteItems(body)).toEqual([
			"Workspaces now sync across devices.",
			"Read the guide at example.com/sync.",
			"feat(shell): reveal the app log",
		]);
	});

	it("leaves the generated notes untouched without highlights", () => {
		expect(withReleaseHighlights(generated, null)).toBe(generated);
	});

	it("rejects highlights the app could not show", () => {
		expect(() => withReleaseHighlights(generated, "Workspaces now sync.\n")).toThrow(
			"Release highlights must contain at least one list item",
		);
	});
});

describe("release highlights files", () => {
	it("reads the file named for the exact version being published", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "release-highlights-test-"));
		await writeFile(path.join(directory, "1.2.3.md"), "- Workspaces now sync\n");

		await expect(readReleaseHighlights(directory, "1.2.3")).resolves.toBe(
			"- Workspaces now sync\n",
		);
		await expect(readReleaseHighlights(directory, "1.2.4")).resolves.toBeNull();
		await expect(
			readReleaseHighlights(directory, "1.2.3-preview-261116-17000"),
		).resolves.toBeNull();
	});

	it("treats a missing highlights directory as no highlights", async () => {
		const directory = path.join(tmpdir(), "release-highlights-test-missing", "nested");
		await expect(readReleaseHighlights(directory, "1.2.3")).resolves.toBeNull();
	});
});
