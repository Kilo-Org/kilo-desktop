import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, stat, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { execa } from "execa";

import {
	classifyReleaseDownload,
	extractReleaseNoteItems,
	getTrackReleaseName,
	getTrackReleaseTag,
	getTrackReleaseVersionFromTag,
	getGithubReleaseWrite,
	getGithubReleaseFlags,
	getLatestAliasKey,
	sanitizeGeneratedReleaseNotes,
	type ReleaseDownload,
} from "./track-release.js";
import {
	getPreviewBuildTime,
	getArtifactKey,
	getPublishAppVersion,
	getReleaseTrack,
	getReleasePrefix,
	getUpdatePublishUrl,
	type ReleaseTrack,
} from "./release.js";

const MOVING_CACHE_CONTROL = "public,max-age=60,must-revalidate";
const IMMUTABLE_CACHE_CONTROL = "public,max-age=31536000,immutable";

async function main(): Promise<void> {
	const repository = required("GITHUB_REPOSITORY");
	const token = required("GITHUB_TOKEN");
	const bucket = required("UPDATE_S3_BUCKET");
	const publishUrl = getUpdatePublishUrl(process.env);
	if (!publishUrl) throw new Error("UPDATE_PUBLISH_URL is required to publish track aliases.");
	const track = getReleaseTrack(process.env);
	const packageJson = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	) as { version: string };
	const version = getPublishAppVersion({
		version: packageJson.version,
		track,
		...(process.env.RELEASE_VERSION ? { releaseVersion: process.env.RELEASE_VERSION } : {}),
		now: getPreviewBuildTime(process.env),
	});
	const tag = getTrackReleaseTag(track, version);
	const name = getTrackReleaseName(track, version);
	const releaseFlags = getGithubReleaseFlags(track, version);
	const artifactsRoot = path.resolve(process.env.RELEASE_ARTIFACTS_DIR ?? "release-artifacts");
	const artifactFiles = await listFiles(artifactsRoot);
	if (artifactFiles.length === 0)
		throw new Error(`No release artifacts found under ${artifactsRoot}.`);

	const previousTag = await findPreviousTrackTag(repository, token, track, tag);
	const generated = await githubJson<{ body: string }>(
		repository,
		token,
		"/releases/generate-notes",
		{
			method: "POST",
			body: {
				tag_name: tag,
				target_commitish: required("GITHUB_SHA"),
				...(previousTag ? { previous_tag_name: previousTag } : {}),
			},
		},
	);
	const bodyMarkdown = sanitizeGeneratedReleaseNotes(generated.body);
	const publishedAt = new Date().toISOString();
	const releaseNotes = {
		schemaVersion: 1 as const,
		track,
		version,
		previousVersion: previousTag ? getTrackReleaseVersionFromTag(track, previousTag) : null,
		title: name,
		publishedAt,
		bodyMarkdown,
		items: extractReleaseNoteItems(bodyMarkdown),
	};

	await upsertGithubRelease(repository, token, {
		tag,
		name,
		body: bodyMarkdown,
		sha: required("GITHUB_SHA"),
		...releaseFlags,
	});
	const stagedAssets = await stageGithubAssets(artifactFiles);
	await execa(
		"gh",
		["release", "upload", tag, ...stagedAssets, "--clobber", "--repo", repository],
		{
			env: { ...process.env, GH_TOKEN: token },
			stdout: "inherit",
			stderr: "inherit",
		},
	);

	const workingDirectory = await mkdtemp(path.join(tmpdir(), "kilo-track-release-"));
	const notesFile = path.join(workingDirectory, `${version}.json`);
	await writeFile(notesFile, `${JSON.stringify(releaseNotes, null, 2)}\n`);

	await publishTrackObjects({
		artifactFiles,
		bucket,
		track,
		notesFile,
		publishedAt,
		publishUrl,
		version,
		workingDirectory,
	});
}

async function findPreviousTrackTag(
	repository: string,
	token: string,
	track: ReleaseTrack,
	currentTag: string,
): Promise<string | undefined> {
	for (let page = 1; page <= 10; page += 1) {
		const releases = await githubJson<Array<{ tag_name: string }>>(
			repository,
			token,
			`/releases?per_page=100&page=${page}`,
		);
		const match = releases.find(
			(release) =>
				release.tag_name !== currentTag &&
				getTrackReleaseVersionFromTag(track, release.tag_name) !== null,
		);
		if (match) return match.tag_name;
		if (releases.length < 100) return undefined;
	}
	return undefined;
}

async function upsertGithubRelease(
	repository: string,
	token: string,
	input: {
		tag: string;
		name: string;
		body: string;
		sha: string;
		prerelease: boolean;
		makeLatest: boolean;
	},
): Promise<void> {
	const existing = await githubJson<{ id: number } | null>(
		repository,
		token,
		`/releases/tags/${encodeURIComponent(input.tag)}`,
		{ allowNotFound: true },
	);
	const body = {
		tag_name: input.tag,
		target_commitish: input.sha,
		name: input.name,
		body: input.body,
		draft: false,
		prerelease: input.prerelease,
		make_latest: input.makeLatest ? "true" : "false",
	};
	const write = getGithubReleaseWrite(existing?.id ?? null);
	await githubJson(repository, token, write.endpoint, {
		method: write.method,
		body,
	});
}

interface TrackObjectPublicationInput {
	readonly artifactFiles: string[];
	readonly bucket: string;
	readonly track: ReleaseTrack;
	readonly notesFile: string;
	readonly publishedAt: string;
	readonly publishUrl: string;
	readonly version: string;
	readonly workingDirectory: string;
}

interface TrackDownloadManifestEntry {
	readonly platform: "linux" | "macos" | "windows";
	readonly arch: string;
	readonly type: "deb" | "dmg" | "setup" | "zip";
	readonly fileName: string;
	readonly url: string;
	readonly size: number;
	readonly sha256: string;
}

export interface TrackReleaseManifest {
	readonly schemaVersion: 1;
	readonly track: ReleaseTrack;
	readonly version: string;
	readonly publishedAt: string;
	readonly releaseNotesUrl: string;
	readonly downloads: TrackDownloadManifestEntry[];
}

type S3ObjectCopier = (
	source: string,
	bucket: string,
	key: string,
	cacheControl: string,
	contentTypeValue: string,
) => Promise<void>;

export async function publishTrackObjects(
	input: TrackObjectPublicationInput,
	copyObject: S3ObjectCopier = s3Copy,
): Promise<TrackReleaseManifest> {
	const releasePrefix = getReleasePrefix(input.track);
	const notesPrefix = `${releasePrefix}/release-notes`;
	await copyObject(
		input.notesFile,
		input.bucket,
		`${notesPrefix}/${input.version}.json`,
		IMMUTABLE_CACHE_CONTROL,
		"application/json",
	);

	const downloads: TrackDownloadManifestEntry[] = [];
	for (const file of input.artifactFiles) {
		const download = classifyReleaseDownload(file);
		if (!download) continue;
		const aliasKey = getLatestAliasKey(input.track, download);
		await copyObject(
			file,
			input.bucket,
			aliasKey,
			MOVING_CACHE_CONTROL,
			contentType(download.type),
		);
		const fileStat = await stat(file);
		downloads.push({
			platform: download.platform,
			arch: download.arch,
			type: download.type,
			fileName: path.basename(aliasKey),
			url: publicUrl(
				input.publishUrl,
				getArtifactKey({
					track: input.track,
					platform: publishedArtifactPlatform(download.platform),
					arch: download.arch,
					fileName: download.fileName,
				}),
			),
			size: fileStat.size,
			sha256: createHash("sha256")
				.update(await readFile(file))
				.digest("hex"),
		});
	}
	if (downloads.length === 0) throw new Error("No user-downloadable release artifacts were found.");

	await copyObject(
		input.notesFile,
		input.bucket,
		`${notesPrefix}/latest.json`,
		MOVING_CACHE_CONTROL,
		"application/json",
	);
	const manifest: TrackReleaseManifest = {
		schemaVersion: 1,
		track: input.track,
		version: input.version,
		publishedAt: input.publishedAt,
		releaseNotesUrl: publicUrl(input.publishUrl, `${notesPrefix}/${input.version}.json`),
		downloads,
	};
	const manifestFile = path.join(input.workingDirectory, "latest.json");
	await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
	await copyObject(
		manifestFile,
		input.bucket,
		`${releasePrefix}/latest.json`,
		MOVING_CACHE_CONTROL,
		"application/json",
	);
	return manifest;
}

function publishedArtifactPlatform(
	platform: ReleaseDownload["platform"],
): "darwin" | "linux" | "win32" {
	switch (platform) {
		case "linux":
			return "linux";
		case "macos":
			return "darwin";
		case "windows":
			return "win32";
	}
}

async function githubJson<T = unknown>(
	repository: string,
	token: string,
	endpoint: string,
	options: { method?: string; body?: unknown; allowNotFound?: boolean } = {},
): Promise<T> {
	const response = await fetch(`https://api.github.com/repos/${repository}${endpoint}`, {
		method: options.method ?? "GET",
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
			...(options.body ? { "Content-Type": "application/json" } : {}),
		},
		...(options.body ? { body: JSON.stringify(options.body) } : {}),
	});
	if (options.allowNotFound && response.status === 404) return null as T;
	if (!response.ok) throw new Error(`GitHub API ${endpoint} failed with HTTP ${response.status}.`);
	return (await response.json()) as T;
}

async function stageGithubAssets(files: string[]): Promise<string[]> {
	const directory = await mkdtemp(path.join(tmpdir(), "kilo-github-release-"));
	const used = new Set<string>();
	const staged: string[] = [];
	for (const file of files) {
		const base = path.basename(file);
		let name = base;
		if (used.has(name)) {
			const download = classifyReleaseDownload(file);
			const prefix = download ? `${download.platform}-${download.arch}` : uniquePathPrefix(file);
			name = `${prefix}-${base}`;
		}
		let suffix = 2;
		while (used.has(name)) {
			name = `${suffix}-${base}`;
			suffix += 1;
		}
		used.add(name);
		const destination = path.join(directory, name);
		await copyFile(file, destination);
		staged.push(destination);
	}
	return staged;
}

function uniquePathPrefix(filePath: string): string {
	return createHash("sha256").update(filePath).digest("hex").slice(0, 8);
}

async function listFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map((entry) => {
			const entryPath = path.join(directory, entry.name);
			return entry.isDirectory() ? listFiles(entryPath) : Promise.resolve([entryPath]);
		}),
	);
	return files.flat().sort();
}

async function s3Copy(
	source: string,
	bucket: string,
	key: string,
	cacheControl: string,
	contentTypeValue: string,
): Promise<void> {
	await execa(
		"aws",
		[
			"s3",
			"cp",
			source,
			`s3://${bucket}/${key}`,
			"--cache-control",
			cacheControl,
			"--content-type",
			contentTypeValue,
			"--only-show-errors",
		],
		{ stdout: "inherit", stderr: "inherit" },
	);
}

function publicUrl(baseUrl: string, key: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function contentType(type: string): string {
	return (
		{
			deb: "application/vnd.debian.binary-package",
			dmg: "application/x-apple-diskimage",
			setup: "application/vnd.microsoft.portable-executable",
			zip: "application/zip",
		}[type] ?? "application/octet-stream"
	);
}

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

const entryPoint = process.argv[1];
if (entryPoint && pathToFileURL(path.resolve(entryPoint)).href === import.meta.url) await main();
