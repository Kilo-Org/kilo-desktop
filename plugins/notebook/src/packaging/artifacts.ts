/** Pinned release used for the staged notebook runtime executables. */
export const NTERACT_RELEASE = {
	tag: "v2.9.0-nightly.202610292131",
	version: "2.9.0-nightly.202610292131",
	channel: "nightly",
	commit: "cea400364a391f6aee5753bf2a5ef6ea79d2991d",
	repository: "https://github.com/nteract/nteract.git",
} as const;

/** Published, platform-independent notebook frontend from the pinned release. */
export const NTERACT_NOTEBOOK_UI = {
	assetName: "nteract-nightly-notebook-ui.tar.gz",
	bytes: 8_741_567,
	sha256: "901c8f7bb646d8510eab55e066383a35654ef2c97b2b85a8a1906a56dc39a807",
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
		assetName: "runtimed-nightly-darwin-arm64",
		executable: "runtimed-nightly",
		bytes: 45_570_016,
		sha256: "b2f45cb9475aa9f9f6fe915fc9fa9eaba2669e28facb1f021d9fb04348406ba2",
	},
	{
		target: "darwin-x64",
		platform: "darwin",
		arch: "x64",
		assetName: "runtimed-nightly-darwin-x64",
		executable: "runtimed-nightly",
		bytes: 47_262_208,
		sha256: "8cd12bef9c9edfcead1bc8f47e198047e3507733a89e9feb5183c177ec411c07",
	},
	{
		target: "linux-x64",
		platform: "linux",
		arch: "x64",
		assetName: "runtimed-nightly-linux-x64",
		executable: "runtimed-nightly",
		bytes: 51_672_024,
		sha256: "8e770e37ba03bd082ba2b952de4362e239a547d26974232a772299bb2ae7e2d0",
	},
	{
		target: "linux-arm64",
		platform: "linux",
		arch: "arm64",
		assetName: "runtimed-nightly-linux-arm64",
		executable: "runtimed-nightly",
		bytes: 53_926_312,
		sha256: "9ba3c5bb9f2920616d4c32a909fb67fc96194813e2e4bbb33f5eddf33d18e158",
	},
	{
		target: "win32-arm64",
		platform: "win32",
		arch: "arm64",
		assetName: "runtimed-nightly-windows-arm64.exe",
		executable: "runtimed-nightly.exe",
		bytes: 43_348_832,
		sha256: "aea64ca91857ea49311fb5d2be8760ea59567a9fe4aec7db2c636a381e289572",
	},
	{
		target: "win32-x64",
		platform: "win32",
		arch: "x64",
		assetName: "runtimed-nightly-windows-x64.exe",
		executable: "runtimed-nightly.exe",
		bytes: 46_461_792,
		sha256: "5fbf730ac0325dedfd3abe9f77ed1f43d85af5a57abf82151959522321923f85",
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
