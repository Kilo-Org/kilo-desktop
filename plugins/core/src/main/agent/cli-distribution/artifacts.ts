/**
 * The native Kilo v2 CLI packages distributed with the desktop application.
 * Their versions follow the `kilo-v2` dist-tag through the workspace catalog;
 * the lockfile fixes the version each build stages (see `stage.ts`).
 */

export interface KiloCliArtifact {
	readonly target: string;
	readonly packageName: string;
	readonly platform: NodeJS.Platform;
	readonly arch: NodeJS.Architecture;
	readonly executable: "kilo2" | "kilo2.exe";
}

export const KILO_CLI_ARTIFACTS = [
	{
		target: "darwin-arm64",
		packageName: "@kilocode/cli-darwin-arm64",
		platform: "darwin",
		arch: "arm64",
		executable: "kilo2",
	},
	{
		target: "windows-arm64",
		packageName: "@kilocode/cli-windows-arm64",
		platform: "win32",
		arch: "arm64",
		executable: "kilo2.exe",
	},
	{
		target: "windows-x64-baseline",
		packageName: "@kilocode/cli-windows-x64-baseline",
		platform: "win32",
		arch: "x64",
		executable: "kilo2.exe",
	},
	{
		target: "linux-x64-baseline",
		packageName: "@kilocode/cli-linux-x64-baseline",
		platform: "linux",
		arch: "x64",
		executable: "kilo2",
	},
	{
		target: "linux-arm64",
		packageName: "@kilocode/cli-linux-arm64",
		platform: "linux",
		arch: "arm64",
		executable: "kilo2",
	},
] as const satisfies readonly KiloCliArtifact[];

export function getKiloCliArtifact(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): KiloCliArtifact {
	const artifact = KILO_CLI_ARTIFACTS.find(
		(candidate) => candidate.platform === platform && candidate.arch === arch,
	);
	if (!artifact) {
		throw new Error(`Kilo CLI is not configured for ${platform}/${arch}.`);
	}
	return artifact;
}
