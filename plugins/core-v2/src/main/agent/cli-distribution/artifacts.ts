/** Pinned native packages distributed with the desktop application. */
import packageJson from "../../../../package.json" with { type: "json" };

const CLI_PACKAGE_NAMES = [
	"@kilocode/cli-darwin-arm64",
	"@kilocode/cli-windows-arm64",
	"@kilocode/cli-windows-x64-baseline",
	"@kilocode/cli-linux-x64-baseline",
	"@kilocode/cli-linux-arm64",
] as const;

const versions = new Set(CLI_PACKAGE_NAMES.map((name) => packageJson.optionalDependencies[name]));
if (versions.size !== 1) throw new Error("Kilo CLI package versions must match.");

export const KILO_CLI_VERSION = packageJson.optionalDependencies[CLI_PACKAGE_NAMES[0]];

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
