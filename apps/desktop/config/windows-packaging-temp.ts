import { mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Squirrel.Windows still uses .NET Framework MAX_PATH (260) in two places:
 * nuget.exe pack, and `extractZipWithEscaping` during `--releasify`.
 *
 * Releasify extracts each nupkg entry to `{TEMP}\{guid}\{entry}`. The GUID
 * folder is 36 characters, so even a short TEMP cannot save zip entries that
 * are themselves longer than ~217 characters. Keep TEMP/packager tmpdir short
 * *and* keep nupkg-relative paths (especially extra-resource trees) short.
 */
export const WINDOWS_MAX_PATH = 260;
const SQUIRREL_TEMP_GUID = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";

export function squirrelExtractPath(tempDirectory: string, nupkgEntry: string): string {
	return path.win32.join(tempDirectory, SQUIRREL_TEMP_GUID, nupkgEntry);
}

export function squirrelExtractFitsMaxPath(tempDirectory: string, nupkgEntry: string): boolean {
	return squirrelExtractPath(tempDirectory, nupkgEntry).length < WINDOWS_MAX_PATH;
}

export function getWindowsPackagingTempDirectory(input: {
	readonly platform: NodeJS.Platform;
	readonly driveRoot: string;
	readonly override?: string | undefined;
}): string | undefined {
	if (input.platform !== "win32") return undefined;
	const override = input.override?.trim();
	if (override) return override;
	return path.win32.join(input.driveRoot, "t");
}

export async function applyWindowsPackagingTemp(
	environment: NodeJS.ProcessEnv = process.env,
	options: {
		readonly platform?: NodeJS.Platform;
		readonly driveRoot?: string;
	} = {},
): Promise<string | undefined> {
	const directory = getWindowsPackagingTempDirectory({
		platform: options.platform ?? process.platform,
		driveRoot: options.driveRoot ?? path.parse(process.cwd()).root,
		...(environment.WINDOWS_PACKAGING_TEMP ? { override: environment.WINDOWS_PACKAGING_TEMP } : {}),
	});
	if (!directory) return undefined;
	await mkdir(directory, { recursive: true });
	environment.TEMP = directory;
	environment.TMP = directory;
	return directory;
}
