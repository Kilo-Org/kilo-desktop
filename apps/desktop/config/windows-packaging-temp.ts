import { mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Squirrel.Windows still uses .NET Framework MAX_PATH (260): nuget.exe pack and
 * `extractZipWithEscaping` during `--releasify` extract each nupkg entry to
 * `{TEMP}\{guid}\{entry}`, so TEMP and the packager tmpdir must stay short.
 */
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
