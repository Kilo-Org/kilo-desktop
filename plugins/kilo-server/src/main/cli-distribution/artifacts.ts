/** Pinned native packages distributed with the desktop application. */
export const KILO_CLI_VERSION = "7.4.21";

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
			"sha512-rFm+Pn6RqlwHsx5dxdg3W9t2uZ3JZG1InHlqbu2IKGMwHqEk3vZpL6q3z+s0cVvA0awJxCsY2KH5iV/j10rAPw==",
		platform: "darwin",
		arch: "arm64",
		executable: "kilo",
	},
	{
		target: "windows-x64-baseline",
		packageName: "@kilocode/cli-windows-x64-baseline",
		integrity:
			"sha512-20W/3I84VO7UlDc6C7o0tGmI8XBlqL9hvb8WKBoLbrmmhCzJ/x7JTA6bCZqxNAAG09ZUicYqeP94OkdxusnEVw==",
		platform: "win32",
		arch: "x64",
		executable: "kilo.exe",
	},
	{
		target: "linux-x64-baseline",
		packageName: "@kilocode/cli-linux-x64-baseline",
		integrity:
			"sha512-T+dM0D4jpJpWir99uvpl+CajMwnIF5UkPHeAI+PM/TIkee8ThI6WZf55KCaz8fQmDsVJHdgKE+OOLcG6qjamXA==",
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
