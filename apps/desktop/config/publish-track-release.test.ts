import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { publishTrackObjects, writeReleaseTagOutput } from "./publish-track-release.js";

/** The `latest.json` schema in clients released before RPM support. */
const preRpmManifestSchema = z.object({
	schemaVersion: z.literal(1),
	track: z.enum(["preview", "stable"]),
	version: z.string(),
	publishedAt: z.string().min(1),
	releaseNotesUrl: z.string().min(1),
	downloads: z.array(
		z.object({
			platform: z.enum(["linux", "macos", "windows"]),
			arch: z.string().min(1),
			type: z.enum(["deb", "dmg", "setup", "zip"]),
			fileName: z.string().min(1),
			url: z.string().min(1),
			size: z.number().int().nonnegative(),
			sha256: z.string().min(1),
		}),
	),
});

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
			"kilo-desktop/latest/release-notes/1.2.3.json",
			"kilo-desktop/latest/latest/linux/x64/kilo-desktop.deb",
			"kilo-desktop/latest/release-notes/latest.json",
			"kilo-desktop/latest/latest.json",
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
				"https://downloads.example.test/kilo-desktop/latest/release-notes/1.2.3.json",
			downloads: [
				{
					arch: "x64",
					fileName: "kilo-desktop.deb",
					platform: "linux",
					sha256: "c7c5c1d70c5dec4416ab6158afd0b223ef40c29b1dc1f97ed9428b94d4cadb1c",
					size: 8,
					type: "deb",
					url: "https://downloads.example.test/kilo-desktop/latest/linux/x64/kilo-desktop_1.2.3_amd64.deb",
				},
			],
		});
		const writtenManifest = JSON.parse(await readFile(copies.at(-1)!.source, "utf8"));
		expect(writtenManifest).toEqual(manifest);
	});

	it("lists an rpm where clients that predate RPM support ignore it", async () => {
		const workingDirectory = await mkdtemp(path.join(tmpdir(), "track-publication-test-"));
		const rpmDirectory = path.join(workingDirectory, "make", "rpm", "x64");
		const debDirectory = path.join(workingDirectory, "make", "deb", "x64");
		await mkdir(rpmDirectory, { recursive: true });
		await mkdir(debDirectory, { recursive: true });
		const artifact = path.join(rpmDirectory, "kilo-desktop-1.2.3-1.x86_64.rpm");
		const deb = path.join(debDirectory, "kilo-desktop_1.2.3_amd64.deb");
		const notesFile = path.join(workingDirectory, "1.2.3.json");
		await writeFile(artifact, "artifact");
		await writeFile(deb, "artifact");
		await writeFile(notesFile, "{}\n");
		const copy = vi.fn(async () => {});

		const manifest = await publishTrackObjects(
			{
				artifactFiles: [artifact, deb],
				bucket: "desktop-releases",
				track: "stable",
				notesFile,
				publishedAt: "2026-08-26T12:00:00.000Z",
				publishUrl: "https://downloads.example.test",
				version: "1.2.3",
				workingDirectory,
			},
			copy,
		);

		expect(copy).toHaveBeenCalledWith(
			artifact,
			"desktop-releases",
			"kilo-desktop/latest/latest/linux/x64/kilo-desktop.rpm",
			"public,max-age=60,must-revalidate",
			"application/x-rpm",
		);
		expect(manifest.downloads).toEqual([expect.objectContaining({ type: "deb" })]);
		expect(manifest.additionalDownloads).toEqual([
			expect.objectContaining({
				platform: "linux",
				arch: "x64",
				type: "rpm",
				fileName: "kilo-desktop.rpm",
				url: "https://downloads.example.test/kilo-desktop/latest/linux/x64/kilo-desktop-1.2.3-1.x86_64.rpm",
			}),
		]);
		expect(preRpmManifestSchema.safeParse(manifest).success).toBe(true);
	});

	it("publishes a release that has only additional downloads", async () => {
		const workingDirectory = await mkdtemp(path.join(tmpdir(), "track-publication-test-"));
		const artifact = path.join(workingDirectory, "rpm", "x64", "kilo-desktop-1.2.3-1.x86_64.rpm");
		await mkdir(path.dirname(artifact), { recursive: true });
		await writeFile(artifact, "artifact");
		const notesFile = path.join(workingDirectory, "1.2.3.json");
		await writeFile(notesFile, "{}\n");

		const manifest = await publishTrackObjects(
			{
				artifactFiles: [artifact],
				bucket: "desktop-releases",
				track: "stable",
				notesFile,
				publishedAt: "2026-08-26T12:00:00.000Z",
				publishUrl: "https://downloads.example.test",
				version: "1.2.3",
				workingDirectory,
			},
			vi.fn(async () => {}),
		);

		expect(manifest.downloads).toEqual([]);
		expect(manifest.additionalDownloads).toHaveLength(1);
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
