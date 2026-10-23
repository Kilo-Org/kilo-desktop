/** Pinned release used for the staged notebook runtime executables. */
export const NTERACT_RELEASE = {
	tag: "v2.9.0-nightly.202610230300",
	version: "2.9.0-nightly.202610230300",
	channel: "nightly",
	commit: "9c85319021bdcd4b03bdfe010ccb4bbc4dc8ed57",
	repository: "https://github.com/nteract/nteract.git",
} as const;

/** Published, platform-independent notebook frontend from the pinned release. */
export const NTERACT_NOTEBOOK_UI = {
	assetName: "nteract-nightly-notebook-ui.tar.gz",
	bytes: 8_662_653,
	sha256: "0c63a75a9115197cbdba88e18fcbf769c58935a735eca2b1873cbd51bb7678a5",
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
		bytes: 39_457_728,
		sha256: "0bc27f788c90082ee202a748990ea8ad79bcc8f7d8ffc00f391264ee41ab0248",
	},
	{
		target: "darwin-x64",
		platform: "darwin",
		arch: "x64",
		assetName: "runtimed-nightly-darwin-x64",
		executable: "runtimed-nightly",
		bytes: 41_908_368,
		sha256: "2bc74516273950aaa337d12db5b7a8d48f5a7f2cccb5bc26dc4e20b61b27ffdc",
	},
	{
		target: "linux-x64",
		platform: "linux",
		arch: "x64",
		assetName: "runtimed-nightly-linux-x64",
		executable: "runtimed-nightly",
		bytes: 45_089_960,
		sha256: "b30d6bd49b0b2f4dfcd1f9998db5f52289522a39c12d7796235b15ea122f5018",
	},
	{
		target: "linux-arm64",
		platform: "linux",
		arch: "arm64",
		assetName: "runtimed-nightly-linux-arm64",
		executable: "runtimed-nightly",
		bytes: 47_358_592,
		sha256: "d482233b8b64e78687c8610d0a224edcff5143823f60644c5a863392464d5e0c",
	},
	{
		target: "win32-arm64",
		platform: "win32",
		arch: "arm64",
		assetName: "runtimed-nightly-windows-arm64.exe",
		executable: "runtimed-nightly.exe",
		bytes: 39_294_816,
		sha256: "df1d2fa32d1f79db2f6608256a936484d7495f24418600dcea55bb81074c7e66",
	},
	{
		target: "win32-x64",
		platform: "win32",
		arch: "x64",
		assetName: "runtimed-nightly-windows-x64.exe",
		executable: "runtimed-nightly.exe",
		bytes: 42_325_344,
		sha256: "62b9a03b2bfbd063f9552a0e15d92fead8898d593a45cb568ed6a79071f2d302",
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
