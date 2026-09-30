/** Pinned release used for the staged notebook runtime executables. */
export const NTERACT_RELEASE = {
	tag: "v2.7.6-nightly.202609291557",
	version: "2.7.6-nightly.202609291557",
	channel: "nightly",
	commit: "d6959be66205165cb1d422d29fbf9b54a3b80d54",
	repository: "https://github.com/nteract/nteract.git",
} as const;

/** Published, platform-independent notebook frontend from the pinned release. */
export const NTERACT_NOTEBOOK_UI = {
	assetName: "nteract-nightly-notebook-ui.tar.gz",
	bytes: 7_850_236,
	sha256: "2a6cb4354043b9ed8599c3fd48578ac92f372234cc133e08adb0072c37dab78b",
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
		bytes: 38_195_600,
		sha256: "67aeaf86c2808683c9c830fa5368104dfc09c2da6c5275651b02d1579b9da73c",
	},
	{
		target: "darwin-x64",
		platform: "darwin",
		arch: "x64",
		assetName: "runtimed-nightly-darwin-x64",
		executable: "runtimed-nightly",
		bytes: 40_528_456,
		sha256: "dff33bc8abc929c114350171aa2a308bcf64b6b10ec175effd2de65355de1f1c",
	},
	{
		target: "linux-x64",
		platform: "linux",
		arch: "x64",
		assetName: "runtimed-nightly-linux-x64",
		executable: "runtimed-nightly",
		bytes: 43_690_096,
		sha256: "89c37d6b33219fed825b18912f8d43cd92986692ca9d797ca15e281e7e4ca348",
	},
	{
		target: "linux-arm64",
		platform: "linux",
		arch: "arm64",
		assetName: "runtimed-nightly-linux-arm64",
		executable: "runtimed-nightly",
		bytes: 45_926_336,
		sha256: "2f1e4636c43403ed5f8b9681837daf63fa8ca8630997f9c3e00ff46ed7289bf5",
	},
	{
		target: "win32-arm64",
		platform: "win32",
		arch: "arm64",
		assetName: "runtimed-nightly-windows-arm64.exe",
		executable: "runtimed-nightly.exe",
		bytes: 37_733_216,
		sha256: "a17dec7b6c699d2845866c68dcae94f228b95fb0ad78a6cf4ffec0da0ffd6ed3",
	},
	{
		target: "win32-x64",
		platform: "win32",
		arch: "x64",
		assetName: "runtimed-nightly-windows-x64.exe",
		executable: "runtimed-nightly.exe",
		bytes: 40_710_496,
		sha256: "46d8e8b12d17cea7a77c0b8d94c88155262e93caffa8bcdc4c38fe11423d3d17",
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
