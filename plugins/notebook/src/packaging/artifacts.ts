/** Pinned release used for the staged notebook runtime executables. */
export const NTERACT_RELEASE = {
	tag: "v2.8.1-nightly.202610070906",
	version: "2.8.1-nightly.202610070906",
	channel: "nightly",
	commit: "217d6fe019133b96138678b4184bd4b62aafc3ab",
	repository: "https://github.com/nteract/nteract.git",
} as const;

/** Published, platform-independent notebook frontend from the pinned release. */
export const NTERACT_NOTEBOOK_UI = {
	assetName: "nteract-nightly-notebook-ui.tar.gz",
	bytes: 7_854_898,
	sha256: "448cb82a89fb89618fc671c64fd2445d2a0821a59eb8134820545a21689eb066",
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
		bytes: 38_370_352,
		sha256: "2aa802bcac47a74fff778b86bacc11af69a370765aab7d51b3ed99245c3b1a95",
	},
	{
		target: "darwin-x64",
		platform: "darwin",
		arch: "x64",
		assetName: "runtimed-nightly-darwin-x64",
		executable: "runtimed-nightly",
		bytes: 40_738_088,
		sha256: "7d97cb79fab807a39e00e32043ee53e027e39474e9714e899f14cd50cc38069a",
	},
	{
		target: "linux-x64",
		platform: "linux",
		arch: "x64",
		assetName: "runtimed-nightly-linux-x64",
		executable: "runtimed-nightly",
		bytes: 43_904_112,
		sha256: "36babd2ca7e017f79db36698fa51e0cb932a1e20014a2ceae10d84384f7601ae",
	},
	{
		target: "linux-arm64",
		platform: "linux",
		arch: "arm64",
		assetName: "runtimed-nightly-linux-arm64",
		executable: "runtimed-nightly",
		bytes: 46_146_696,
		sha256: "94aa276b49a4fc67347b37501ff6d6372c88ecec94d4840a4cc262385a5172e9",
	},
	{
		target: "win32-arm64",
		platform: "win32",
		arch: "arm64",
		assetName: "runtimed-nightly-windows-arm64.exe",
		executable: "runtimed-nightly.exe",
		bytes: 38_146_048,
		sha256: "3fe924981b199369bbe5b724d68dfe5a93dfbec33fc933e4298d60bb1cfd41e2",
	},
	{
		target: "win32-x64",
		platform: "win32",
		arch: "x64",
		assetName: "runtimed-nightly-windows-x64.exe",
		executable: "runtimed-nightly.exe",
		bytes: 41_187_328,
		sha256: "022da12dbe2c81e6f3c2207e6b6a487c8da45687d74acd21f8bba312d4ae19e7",
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
