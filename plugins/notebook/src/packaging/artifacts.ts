/** Pinned release used for the staged notebook runtime executables. */
export const NTERACT_RELEASE = {
	tag: "v2.7.0-stable.202608172336",
	commit: "f28fa6666cf4aab0e7dd1c6f5364a810107566b6",
	repository: "https://github.com/nteract/nteract.git",
} as const;

/** Source pin for the staged notebook UI. */
export const NTERACT_NOTEBOOK_SOURCE = {
	tag: NTERACT_RELEASE.tag,
	commit: NTERACT_RELEASE.commit,
	repository: "https://github.com/nteract/nteract.git",
} as const;

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

export interface BundledNativeExecutable {
	readonly executable: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly source: ReleaseAsset;
	readonly extraction:
		| { readonly kind: "direct" }
		| { readonly kind: "tar-gz" | "nsis"; readonly entryPath: string };
}

export interface NteractMcpArtifact {
	readonly target: string;
	readonly platform: NodeJS.Platform;
	readonly arch: NodeJS.Architecture;
	readonly nteractMcp: BundledNativeExecutable;
	readonly runt: BundledNativeExecutable;
}

const DARWIN_ARM64_APP = {
	assetName: "nteract-stable-darwin-arm64.app.tar.gz",
	bytes: 37_323_740,
	sha256: "8ed40d51471a4e22869195329c46d0e891d0bbc0ac01b51dd23491f7b067c621",
} as const satisfies ReleaseAsset;

const DARWIN_X64_APP = {
	assetName: "nteract-stable-darwin-x64.app.tar.gz",
	bytes: 37_557_516,
	sha256: "8e1e7d6e3445792355ec58614a8311b0a5af7c81b887ca2e105e75c024b06ea5",
} as const satisfies ReleaseAsset;

const WINDOWS_X64_INSTALLER = {
	assetName: "nteract-stable-windows-x64.exe",
	bytes: 27_497_600,
	sha256: "d6eb760da4b01553ee597fa1da3fe00f16115bf6d1ee5cab759afb73be15187d",
} as const satisfies ReleaseAsset;

/**
 * The resilient MCP proxy and its `runt mcp` child. nteract publishes the
 * Linux proxy directly; macOS and Windows sidecars are extracted from the
 * matching signed app artifacts from the same release.
 */
export const NTERACT_MCP_ARTIFACTS = [
	{
		target: "darwin-arm64",
		platform: "darwin",
		arch: "arm64",
		nteractMcp: {
			executable: "nteract-mcp",
			bytes: 3_466_432,
			sha256: "d23a5d0aaf03191debac173e06e982a5c73e87df208a53323c62b5e7ff73b16a",
			source: DARWIN_ARM64_APP,
			extraction: {
				kind: "tar-gz",
				entryPath: "nteract.app/Contents/MacOS/nteract-mcp",
			},
		},
		runt: {
			executable: "runt",
			bytes: 17_747_264,
			sha256: "5fd2a411a62b743a17050dd3dcc2f9c7edeaf8c83a913d141bd477e52481ed17",
			source: DARWIN_ARM64_APP,
			extraction: {
				kind: "tar-gz",
				entryPath: "nteract.app/Contents/MacOS/runt",
			},
		},
	},
	{
		target: "darwin-x64",
		platform: "darwin",
		arch: "x64",
		nteractMcp: {
			executable: "nteract-mcp",
			bytes: 3_566_192,
			sha256: "bc666238799f181d41f1f79462e878a31af90e60e3c8b7e67b5c50887d0addb6",
			source: DARWIN_X64_APP,
			extraction: {
				kind: "tar-gz",
				entryPath: "nteract.app/Contents/MacOS/nteract-mcp",
			},
		},
		runt: {
			executable: "runt",
			bytes: 19_305_776,
			sha256: "0ab488cb409333df2c43bf74986f9b0a2d6c89de5175bf06f241381255c8e01c",
			source: DARWIN_X64_APP,
			extraction: {
				kind: "tar-gz",
				entryPath: "nteract.app/Contents/MacOS/runt",
			},
		},
	},
	{
		target: "linux-x64",
		platform: "linux",
		arch: "x64",
		nteractMcp: {
			executable: "nteract-mcp",
			bytes: 4_072_440,
			sha256: "2c03fbd26490cf76ebae4d0234dcdd201ba6db1a03ea56cf2cbea5d9614771a9",
			source: {
				assetName: "nteract-mcp-linux-x64",
				bytes: 4_072_440,
				sha256: "2c03fbd26490cf76ebae4d0234dcdd201ba6db1a03ea56cf2cbea5d9614771a9",
			},
			extraction: { kind: "direct" },
		},
		runt: {
			executable: "runt",
			bytes: 20_970_688,
			sha256: "f0fe32653248c4897bb3d0e61a20ca41555fbd4170feabe3cf080fd87167c4df",
			source: {
				assetName: "runt-linux-x64",
				bytes: 20_970_688,
				sha256: "f0fe32653248c4897bb3d0e61a20ca41555fbd4170feabe3cf080fd87167c4df",
			},
			extraction: { kind: "direct" },
		},
	},
	{
		target: "win32-x64",
		platform: "win32",
		arch: "x64",
		nteractMcp: {
			executable: "nteract-mcp.exe",
			bytes: 3_366_752,
			sha256: "36492965adf53fe70ab841aa7aace3c8e249fff93286fea24ea6943aeb0e96cb",
			source: WINDOWS_X64_INSTALLER,
			extraction: { kind: "nsis", entryPath: "nteract-mcp.exe" },
		},
		runt: {
			executable: "runt.exe",
			bytes: 19_807_584,
			sha256: "ea381d8cafdcb8e9d66dfca436c1628f23c622be4714dfa1d5e7f18c821294f7",
			source: WINDOWS_X64_INSTALLER,
			extraction: { kind: "nsis", entryPath: "runt.exe" },
		},
	},
] as const satisfies readonly NteractMcpArtifact[];

/**
 * `runtimed` singleton daemon. These are standalone, Python-free executables
 * published by the same nteract release as the `runt` CLI.
 */
export const RUNTIMED_ARTIFACTS = [
	{
		target: "darwin-arm64",
		platform: "darwin",
		arch: "arm64",
		assetName: "runtimed-darwin-arm64",
		executable: "runtimed",
		bytes: 38_135_648,
		sha256: "b89cb5e1bf6a0ef6a1c01056a058417a23e85b9bc0fe9a0bbb4bd94a8421b4d2",
	},
	{
		target: "darwin-x64",
		platform: "darwin",
		arch: "x64",
		assetName: "runtimed-darwin-x64",
		executable: "runtimed",
		bytes: 40_522_416,
		sha256: "91844bf000253bff4ac2fda540556b8836ac5e9200f07f11bdf8c86f90514a67",
	},
	{
		target: "linux-x64",
		platform: "linux",
		arch: "x64",
		assetName: "runtimed-linux-x64",
		executable: "runtimed",
		bytes: 41_957_656,
		sha256: "6a68308bfc3f0de3fb240e1a9575d8b7fc8039b78374e7af3b1a3000f86b8a06",
	},
	{
		target: "win32-x64",
		platform: "win32",
		arch: "x64",
		assetName: "runtimed-windows-x64.exe",
		executable: "runtimed.exe",
		bytes: 40_771_936,
		sha256: "13a45ed599a1870bb1f7c41cedd0c5ccc5226ee8e6c21e3135c91e614e134c36",
	},
] as const satisfies readonly NativeReleaseArtifact[];

export function nteractDownloadUrl(assetName: string): string {
	return `https://github.com/nteract/nteract/releases/download/${NTERACT_RELEASE.tag}/${assetName}`;
}

export function findNteractMcpArtifact(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): NteractMcpArtifact | undefined {
	return NTERACT_MCP_ARTIFACTS.find(
		(candidate) => candidate.platform === platform && candidate.arch === arch,
	);
}

export function getNteractMcpArtifact(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): NteractMcpArtifact {
	const artifact = findNteractMcpArtifact(platform, arch);
	if (!artifact) {
		throw new Error(`nteract-mcp is not configured for ${platform}/${arch}`);
	}
	return artifact;
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
