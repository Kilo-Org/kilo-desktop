import { readFile, writeFile } from "node:fs/promises";

import {
	getCanaryBuildTime,
	getPublishAppVersion,
	getReleaseChannel,
	type ReleaseEnvironment,
} from "./release.js";

/**
 * Forge makers name zip/dmg/nupkg/deb files and macOS RELEASES.json from the
 * source package.json version, not the packaged app stamp. This writes the
 * publish version for the duration of `run` and always restores the original
 * file, including when packaging throws.
 */
export async function withStampedDesktopPackageJson<T>(
	manifestPath: string,
	environment: ReleaseEnvironment,
	run: () => Promise<T>,
): Promise<T> {
	const original = await readFile(manifestPath, "utf8");
	const manifest = parsePackageManifest(original, manifestPath);
	manifest.version = getPublishAppVersion({
		version: manifest.version,
		channel: getReleaseChannel(environment),
		now: getCanaryBuildTime(environment),
	});
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	try {
		return await run();
	} finally {
		await writeFile(manifestPath, original);
	}
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
