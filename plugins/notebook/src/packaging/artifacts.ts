/** Pinned release used for the staged notebook runtime executables. */
export const NTERACT_RELEASE = {
	tag: "v2.10.1-stable.202611161848",
	version: "2.10.1-stable.202611161848",
	channel: "stable",
	commit: "b275d446bbfdbfb8c36934e5b2a2ebe08acad82f",
	repository: "https://github.com/nteract/nteract.git",
} as const;

/** Published, platform-independent notebook frontend from the pinned release. */
export const NTERACT_NOTEBOOK_UI = {
	assetName: "nteract-stable-notebook-ui.tar.gz",
	bytes: 11_370_612,
	sha256: "2b7c87a5cb9b6cf89c49f79d5fb5d25de053010d02f16e1ce89e7f5e5430a560",
} as const satisfies ReleaseAsset;

export interface NativeReleaseArtifact {
	readonly target: string;
	readonly platform: NodeJS.Platform;
	readonly arch: NodeJS.Architecture;
	readonly assetName: string;
	readonly executable: string;
	readonly bytes: number;
	readonly sha256: string;
}

export type RuntimedArtifact = NativeReleaseArtifact;

export interface ReleaseAsset {
	readonly assetName: string;
	readonly bytes: number;
	readonly sha256: string;
}

/**
 * `runtimed` singleton daemon. These are standalone, Python-free executables
 * published by the same nteract release as the embedded notebook UI.
 */
export const RUNTIMED_ARTIFACTS = [
	{
		target: "darwin-arm64",
		platform: "darwin",
		arch: "arm64",
		assetName: "runtimed-darwin-arm64",
		executable: "runtimed",
		bytes: 48_079_408,
		sha256: "e8bceebc733af65c4ccfd16d0008ed7adb01e45045f67669e4105693161ec5b2",
	},
	{
		target: "darwin-x64",
		platform: "darwin",
		arch: "x64",
		assetName: "runtimed-darwin-x64",
		executable: "runtimed",
		bytes: 50_043_368,
		sha256: "a3c2a52b9c5bb635445ab827a7d4586901a878a18ccf13d9088346298951d507",
	},
	{
		target: "linux-x64",
		platform: "linux",
		arch: "x64",
		assetName: "runtimed-linux-x64",
		executable: "runtimed",
		bytes: 53_751_968,
		sha256: "bfc66270070c0dbe1a1e219f13bb53b11fc9a9d05b06b56bc9f7a22eb3568131",
	},
	{
		target: "linux-arm64",
		platform: "linux",
		arch: "arm64",
		assetName: "runtimed-linux-arm64",
		executable: "runtimed",
		bytes: 56_071_448,
		sha256: "00d17e7ef3d86167ec76a3c05b4d53e6764aad1dafc3a178c5a95dd3e494a883",
	},
	{
		target: "win32-arm64",
		platform: "win32",
		arch: "arm64",
		assetName: "runtimed-windows-arm64.exe",
		executable: "runtimed.exe",
		bytes: 45_688_672,
		sha256: "681149ff5d3a349abbfc2fd17331e938b23dce2a600ac0b77e76eacaa1c65a6d",
	},
	{
		target: "win32-x64",
		platform: "win32",
		arch: "x64",
		assetName: "runtimed-windows-x64.exe",
		executable: "runtimed.exe",
		bytes: 49_203_552,
		sha256: "0b495516c0460572dd4b20c2ce2629ec418b772b7eb500188d91416566bd3372",
	},
] as const satisfies readonly NativeReleaseArtifact[];

export function nteractDownloadUrl(assetName: string): string {
	return `https://github.com/nteract/nteract/releases/download/${NTERACT_RELEASE.tag}/${assetName}`;
}

export function findRuntimedArtifact(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): NativeReleaseArtifact | undefined {
	return RUNTIMED_ARTIFACTS.find(
		(candidate) => candidate.platform === platform && candidate.arch === arch,
	);
}

export function getRuntimedArtifact(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): NativeReleaseArtifact {
	const artifact = findRuntimedArtifact(platform, arch);
	if (!artifact) {
		throw new Error(`runtimed is not configured for ${platform}/${arch}`);
	}
	return artifact;
}

export function runtimedDownloadUrl(artifact: NativeReleaseArtifact): string {
	return nteractDownloadUrl(artifact.assetName);
}
