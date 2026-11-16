import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { publishTrackObjects, writeReleaseTagOutput } from "./publish-track-release.js";

describe("track object publication", () => {
	it("publishes immutable notes, stable aliases, the note pointer, then the manifest", async () => {
		const workingDirectory = await mkdtemp(path.join(tmpdir(), "track-publication-test-"));
		const artifactDirectory = path.join(workingDirectory, "make", "deb", "linux", "x64");
		await mkdir(artifactDirectory, { recursive: true });
		const artifact = path.join(artifactDirectory, "kilo-desktop_1.2.3_amd64.deb");
		const notesFile = path.join(workingDirectory, "1.2.3.json");
		await writeFile(artifact, "artifact");
		await writeFile(notesFile, '{"schemaVersion":1}\n');
		const copies: Array<{
			source: string;
			key: string;
			cacheControl: string;
			contentType: string;
		}> = [];
		const copy = vi.fn(
			async (
				source: string,
				_bucket: string,
				key: string,
				cacheControl: string,
				contentType: string,
			) => {
				copies.push({ source, key, cacheControl, contentType });
			},
		);

		const manifest = await publishTrackObjects(
			{
				artifactFiles: [artifact, path.join(workingDirectory, "RELEASES.json")],
				bucket: "desktop-releases",
				track: "stable",
				notesFile,
				publishedAt: "2026-08-26T12:00:00.000Z",
				publishUrl: "https://downloads.example.test/",
				version: "1.2.3",
				workingDirectory,
			},
			copy,
		);

		expect(copies.map(({ key }) => key)).toEqual([
			"kilo-desktop-ci-test/latest/release-notes/1.2.3.json",
			"kilo-desktop-ci-test/latest/latest/linux/x64/kilo-desktop.deb",
			"kilo-desktop-ci-test/latest/release-notes/latest.json",
			"kilo-desktop-ci-test/latest/latest.json",
		]);
		expect(copies[0]).toMatchObject({
			cacheControl: "public,max-age=31536000,immutable",
			contentType: "application/json",
		});
		expect(copies.slice(1).every(({ cacheControl }) => cacheControl.includes("max-age=60"))).toBe(
			true,
		);
		expect(manifest).toMatchObject({
			schemaVersion: 1,
			track: "stable",
			version: "1.2.3",
			releaseNotesUrl:
				"https://downloads.example.test/kilo-desktop-ci-test/latest/release-notes/1.2.3.json",
			downloads: [
				{
					arch: "x64",
					fileName: "kilo-desktop.deb",
					platform: "linux",
					sha256: "c7c5c1d70c5dec4416ab6158afd0b223ef40c29b1dc1f97ed9428b94d4cadb1c",
					size: 8,
					type: "deb",
					url: "https://downloads.example.test/kilo-desktop-ci-test/latest/linux/x64/kilo-desktop_1.2.3_amd64.deb",
				},
			],
		});
		const writtenManifest = JSON.parse(await readFile(copies.at(-1)!.source, "utf8"));
		expect(writtenManifest).toEqual(manifest);
	});

	it("refuses to advance pointers when no downloadable artifact exists", async () => {
		const workingDirectory = await mkdtemp(path.join(tmpdir(), "track-publication-test-"));
		const notesFile = path.join(workingDirectory, "1.2.3.json");
		await writeFile(notesFile, "{}\n");
		const copy = vi.fn(async () => {});

		await expect(
			publishTrackObjects(
				{
					artifactFiles: [path.join(workingDirectory, "RELEASES.json")],
					bucket: "desktop-releases",
					track: "preview",
					notesFile,
					publishedAt: "2026-08-26T12:00:00.000Z",
					publishUrl: "https://downloads.example.test",
					version: "1.2.3",
					workingDirectory,
				},
				copy,
			),
		).rejects.toThrow("No user-downloadable release artifacts");
		expect(copy).toHaveBeenCalledOnce();
	});
});

describe("release tag output", () => {
	it("appends the published tag to the GitHub Actions step output file", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "release-tag-output-test-"));
		const outputFile = path.join(directory, "output");
		await writeFile(outputFile, "existing=value\n");

		await writeReleaseTagOutput("v1.2.3-preview-261104-11000", { GITHUB_OUTPUT: outputFile });

		expect(await readFile(outputFile, "utf8")).toBe(
			"existing=value\ntag=v1.2.3-preview-261104-11000\n",
		);
	});

	it("does nothing outside GitHub Actions", async () => {
		await expect(writeReleaseTagOutput("v1.2.3", {})).resolves.toBeUndefined();
	});
});
