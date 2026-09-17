/** Pinned native packages distributed with the desktop application. */
export const KILO_CLI_VERSION = "7.6.2";

export interface KiloCliArtifact {
	readonly target: string;
	readonly packageName: string;
	readonly integrity: string;
	readonly platform: NodeJS.Platform;
	readonly arch: NodeJS.Architecture;
	readonly executable: "kilo" | "kilo.exe";
}

export const KILO_CLI_ARTIFACTS = [
	{
		target: "darwin-arm64",
		packageName: "@kilocode/cli-darwin-arm64",
		integrity:
			"sha512-hBsGAYTLmmMHUQvsyXlL85O3DiU+HKgUgqAuJ5D3ak4DQtU826f2V4sDITcD1FMg9iF/yOs3EQtj1ROTTgMpBA==",
		platform: "darwin",
		arch: "arm64",
		executable: "kilo",
	},
	{
		target: "windows-x64-baseline",
		packageName: "@kilocode/cli-windows-x64-baseline",
		integrity:
			"sha512-Zriw1bv2iq9U/sguVwrcPRzUq0B36oXIkKx62ySv5DtwjeKPtNV690QMWpJtcztdyZefXFf8jCwiqMt0+wUqQg==",
		platform: "win32",
		arch: "x64",
		executable: "kilo.exe",
	},
	{
		target: "linux-x64-baseline",
		packageName: "@kilocode/cli-linux-x64-baseline",
		integrity:
			"sha512-TfTu7+xbpNSJ5oy9qLrAvN6VJy1PrYFjlr2KLnVi0FLIbM3oC5yZeZPB6cGU+bdpGL3M+lZUOssF/pL6sZBKBQ==",
		platform: "linux",
		arch: "x64",
		executable: "kilo",
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
