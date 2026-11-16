/** Pinned release used for the staged notebook runtime executables. */
export const NTERACT_RELEASE = {
	tag: "v2.10.0-stable.202611130133",
	version: "2.10.0-stable.202611130133",
	channel: "stable",
	commit: "211f11c4169910b13ac5da676a9da6718791a77a",
	repository: "https://github.com/nteract/nteract.git",
} as const;

/** Published, platform-independent notebook frontend from the pinned release. */
export const NTERACT_NOTEBOOK_UI = {
	assetName: "nteract-stable-notebook-ui.tar.gz",
	bytes: 11_358_418,
	sha256: "eb00998377506e411da008e2368afe24f234ab1c976cba36b4607826f7c8dd90",
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
		bytes: 45_782_784,
		sha256: "63afcfeb5f229a0bdf6442debb2fd5d9ebcd318e82cf31c06e1041a8514ee232",
	},
	{
		target: "darwin-x64",
		platform: "darwin",
		arch: "x64",
		assetName: "runtimed-darwin-x64",
		executable: "runtimed",
		bytes: 47_472_448,
		sha256: "823a19063e3ad3e3eec4b54e1c278663b59816732b21ca2eb3e7f0e906033740",
	},
	{
		target: "linux-x64",
		platform: "linux",
		arch: "x64",
		assetName: "runtimed-linux-x64",
		executable: "runtimed",
		bytes: 51_883_424,
		sha256: "eb0a5851e4e51f1cfa5d27ed074292312495503ba09e89e15a1f259dde47abdb",
	},
	{
		target: "linux-arm64",
		platform: "linux",
		arch: "arm64",
		assetName: "runtimed-linux-arm64",
		executable: "runtimed",
		bytes: 54_180_840,
		sha256: "4ecda33c1fea971006421787f77d8f793ee4ea55533c3518d52acc2e7565f4f5",
	},
	{
		target: "win32-arm64",
		platform: "win32",
		arch: "arm64",
		assetName: "runtimed-windows-arm64.exe",
		executable: "runtimed.exe",
		bytes: 43_485_536,
		sha256: "2303f900c99eba9ae728163c0a662b042014e43b3da73767f63213a5603b356e",
	},
	{
		target: "win32-x64",
		platform: "win32",
		arch: "x64",
		assetName: "runtimed-windows-x64.exe",
		executable: "runtimed.exe",
		bytes: 46_592_864,
		sha256: "41748ccfeb2943c947b687909e93ea8c07dc310e81a77f1c50f181087e69dfb2",
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
