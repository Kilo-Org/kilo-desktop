import { mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Squirrel's bundled nuget.exe still uses the legacy 260-character MAX_PATH
 * APIs. Point packager/Squirrel temp at a drive-root directory so unpacked
 * native addon paths stay under the limit.
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
