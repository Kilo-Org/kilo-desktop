export const KILO_CLI_VERSION = "7.4.20";

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
			"sha512-7Z2pGAdz0Y4MEb6vd+5kcbFoT07L6gOLo1AVM5w3UvhXhq2mCLbzVV2EjvvxoWruEVJ2FM0KPsYWcuIKvaNLgA==",
		platform: "darwin",
		arch: "arm64",
		executable: "kilo",
	},
	{
		target: "windows-x64-baseline",
		packageName: "@kilocode/cli-windows-x64-baseline",
		integrity:
			"sha512-lCEccxneSfmDDQU0TOqAZtmw/zWMAz5YyVKGOeXa5I3A1qgioTciNanDrjrsqORfSL7QOAUdA00v184ufEDKrw==",
		platform: "win32",
		arch: "x64",
		executable: "kilo.exe",
	},
	{
		target: "linux-x64-baseline",
		packageName: "@kilocode/cli-linux-x64-baseline",
		integrity:
			"sha512-l8riKK59J8YUrmAuCmD9MJVKUUs2kqae9DKXnHDhc5Hvesf/u/+hOB+InX37R9MOoj9yWzZGCOQbsPUfNPkD1g==",
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
