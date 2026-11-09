import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	getPreviewBuildTime,
	getPublishAppVersion,
	getReleaseTrack,
	type ReleaseEnvironment,
} from "./release.js";

export const RELEASE_PACKAGE_FILES = [
	"apps/desktop/package.json",
	"apps/web/package.json",
] as const;

/**
 * Forge makers name zip/dmg/nupkg/deb files and macOS RELEASES.json from the
 * source package.json version, not the packaged app stamp. This aligns every
 * release-coupled manifest for the duration of `run` and always restores the
 * originals, including when alignment or packaging throws.
 */
export async function withStampedReleasePackageVersions<T>(
	workspaceRoot: string,
	environment: ReleaseEnvironment,
	run: () => Promise<T>,
): Promise<T> {
	const manifests = await readReleasePackageManifests(workspaceRoot);
	const desktopManifest = manifests.find(
		({ relativePath }) => relativePath === "apps/desktop/package.json",
	);
	if (!desktopManifest) throw new Error("Desktop package manifest is not release-coupled.");
	const version = getPublishAppVersion({
		version: desktopManifest.manifest.version,
		track: getReleaseTrack(environment),
		...(environment.RELEASE_VERSION ? { releaseVersion: environment.RELEASE_VERSION } : {}),
		now: getPreviewBuildTime(environment),
	});
	try {
		await writeReleasePackageManifests(manifests, version);
		return await run();
	} finally {
		await Promise.all(manifests.map(({ filePath, original }) => writeFile(filePath, original)));
	}
}

export async function writeReleasePackageVersions(
	workspaceRoot: string,
	version: string,
): Promise<void> {
	const manifests = await readReleasePackageManifests(workspaceRoot);
	const validatedVersion = getPublishAppVersion({
		version,
		track: "stable",
		releaseVersion: version,
	});
	await writeReleasePackageManifests(manifests, validatedVersion);
}

export async function writePublishPackageVersions(
	workspaceRoot: string,
	environment: ReleaseEnvironment,
): Promise<string> {
	const manifests = await readReleasePackageManifests(workspaceRoot);
	const desktopManifest = manifests.find(
		({ relativePath }) => relativePath === "apps/desktop/package.json",
	);
	if (!desktopManifest) throw new Error("Desktop package manifest is not release-coupled.");
	const version = getPublishAppVersion({
		version: desktopManifest.manifest.version,
		track: getReleaseTrack(environment),
		...(environment.RELEASE_VERSION ? { releaseVersion: environment.RELEASE_VERSION } : {}),
		now: getPreviewBuildTime(environment),
	});
	await writeReleasePackageManifests(manifests, version);
	return version;
}

interface ReleasePackageManifest {
	readonly relativePath: (typeof RELEASE_PACKAGE_FILES)[number];
	readonly filePath: string;
	readonly original: string;
	readonly manifest: { version: string } & Record<string, unknown>;
}

async function readReleasePackageManifests(
	workspaceRoot: string,
): Promise<ReleasePackageManifest[]> {
	return Promise.all(
		RELEASE_PACKAGE_FILES.map(async (relativePath) => {
			const filePath = new URL(relativePath, pathToFileURL(`${workspaceRoot}/`));
			const original = await readFile(filePath, "utf8");
			return {
				relativePath,
				filePath: fileURLToPath(filePath),
				original,
				manifest: parsePackageManifest(original, fileURLToPath(filePath)),
			};
		}),
	);
}

async function writeReleasePackageManifests(
	manifests: ReleasePackageManifest[],
	version: string,
): Promise<void> {
	await Promise.all(
		manifests.map(({ filePath, manifest }) =>
			writeFile(filePath, `${JSON.stringify({ ...manifest, version }, null, "\t")}\n`),
		),
	);
}

function parsePackageManifest(
	contents: string,
	manifestPath: string,
): { version: string } & Record<string, unknown> {
	const parsed: unknown = JSON.parse(contents);
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		typeof (parsed as { version?: unknown }).version !== "string"
	) {
		throw new Error(`Invalid package manifest: ${manifestPath}`);
	}
	return parsed as { version: string } & Record<string, unknown>;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const releaseVersion = process.argv[2]?.trim();
	const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
	if (releaseVersion) {
		await writeReleasePackageVersions(workspaceRoot, releaseVersion);
	} else {
		await writePublishPackageVersions(workspaceRoot, process.env);
	}
}
