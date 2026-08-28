/** Pinned native packages distributed with the desktop application. */
export const KILO_CLI_VERSION = "7.5.5";

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
			"sha512-9jY1PZYFYqTEz2eyDBLFCIgHnZZ3fwM5zxi5hes0EjqEyhUUayz6bdLpYVq/J5LvkRkImmdd7LVhULcb8NWpgA==",
		platform: "darwin",
		arch: "arm64",
		executable: "kilo",
	},
	{
		target: "windows-x64-baseline",
		packageName: "@kilocode/cli-windows-x64-baseline",
		integrity:
			"sha512-UocGe8J3xB0cLyRfTsIAuvqExaFcppGtXOoZ5PdoTm6ItwxiV4H+rzz+uHOrNGeb86/5B5VlOpbWv2IuAHGyrg==",
		platform: "win32",
		arch: "x64",
		executable: "kilo.exe",
	},
	{
		target: "linux-x64-baseline",
		packageName: "@kilocode/cli-linux-x64-baseline",
		integrity:
			"sha512-BPcHloQkKjexx3RNUaB+Ae3KKDibSWLMNByAoDvcb10yrtDD3JPLnFL97JIhTS0BaDSNKyla8oEtf41Kg6Wqdw==",
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
