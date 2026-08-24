/** Pinned release used for the staged notebook runtime executables. */
export const NTERACT_RELEASE = {
	tag: "v2.7.0-nightly.202608182247",
	version: "2.7.0-nightly.202608182247",
	channel: "nightly",
	commit: "de7a8ed1c658ca963d117a3abc046b4af9f12be0",
	repository: "https://github.com/nteract/nteract.git",
} as const;

/** Published, platform-independent notebook frontend from the pinned release. */
export const NTERACT_NOTEBOOK_UI = {
	assetName: "nteract-nightly-notebook-ui.tar.gz",
	bytes: 7_816_621,
	sha256: "094f6a644b47542fa55e178ffdea96a3890cffb3ce286f84d16ff63d4a5c1d8b",
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
	assetName: "nteract-nightly-darwin-arm64.app.tar.gz",
	bytes: 38_113_832,
	sha256: "0c061c6ad484cf484d5cb5f748ef301d5090e55552e95894bbd8a9d671a3c8a8",
} as const satisfies ReleaseAsset;

const DARWIN_X64_APP = {
	assetName: "nteract-nightly-darwin-x64.app.tar.gz",
	bytes: 38_346_842,
	sha256: "b3c50e4ddfa692639c53c0740bdb96e8dfd46a8fae7432c77a76908692687fd2",
} as const satisfies ReleaseAsset;

const WINDOWS_X64_INSTALLER = {
	assetName: "nteract-nightly-windows-x64.exe",
	bytes: 27_629_512,
	sha256: "adf10a3bf8134b07bdd3551b433b7d5af22bfec179c8bd681310feda0731bf33",
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
			bytes: 3_466_480,
			sha256: "eabc71e249dba2c2fc932b622b38858bb7b3f0ad6f071e5eadccfbf0ee3d4922",
			source: DARWIN_ARM64_APP,
			extraction: {
				kind: "tar-gz",
				entryPath: "nteract Nightly.app/Contents/MacOS/nteract-mcp",
			},
		},
		runt: {
			executable: "runt-nightly",
			bytes: 17_747_264,
			sha256: "3fa84c0da94e3ee63a7ef038ee03d6c64523e4a9d4d87b1cbe52a53d117feadd",
			source: DARWIN_ARM64_APP,
			extraction: {
				kind: "tar-gz",
				entryPath: "nteract Nightly.app/Contents/MacOS/runt",
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
			sha256: "965d66c0f0c4527cd2f99e999aac4c9165a53868eae34d9a0af60f36bf4bfcb9",
			source: DARWIN_X64_APP,
			extraction: {
				kind: "tar-gz",
				entryPath: "nteract Nightly.app/Contents/MacOS/nteract-mcp",
			},
		},
		runt: {
			executable: "runt-nightly",
			bytes: 19_305_792,
			sha256: "4f6c6c99dcabd0aad124c0535e6763a1523e8e1bec7c76248966b9b5c7590885",
			source: DARWIN_X64_APP,
			extraction: {
				kind: "tar-gz",
				entryPath: "nteract Nightly.app/Contents/MacOS/runt",
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
			sha256: "8702cd00700e959e7ca67747f7fa7cf6e40078c3b7ffd3bde4e17767063c0290",
			source: {
				assetName: "nteract-mcp-nightly-linux-x64",
				bytes: 4_072_440,
				sha256: "8702cd00700e959e7ca67747f7fa7cf6e40078c3b7ffd3bde4e17767063c0290",
			},
			extraction: { kind: "direct" },
		},
		runt: {
			executable: "runt-nightly",
			bytes: 20_970_952,
			sha256: "3ab3f579ecd2c749bde2c8b2b686b21aefbc62f70fddf13668f448fe3c018cff",
			source: {
				assetName: "runt-nightly-linux-x64",
				bytes: 20_970_952,
				sha256: "3ab3f579ecd2c749bde2c8b2b686b21aefbc62f70fddf13668f448fe3c018cff",
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
			sha256: "55b68c8968a1d5b9754224a09e4130bf8756757446c48ccd1a226227019c2f0c",
			source: WINDOWS_X64_INSTALLER,
			extraction: { kind: "nsis", entryPath: "nteract-mcp.exe" },
		},
		runt: {
			executable: "runt-nightly.exe",
			bytes: 19_807_576,
			sha256: "da400d5e166c9e8f4d9c98522ea9dc93836fa4dc998945e2a482768cee69d3a8",
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
		assetName: "runtimed-nightly-darwin-arm64",
		executable: "runtimed-nightly",
		bytes: 38_135_696,
		sha256: "387b7fba72d24275005e265ee8ecae30a32c18e67b469c9e116940a473c9ab5a",
	},
	{
		target: "darwin-x64",
		platform: "darwin",
		arch: "x64",
		assetName: "runtimed-nightly-darwin-x64",
		executable: "runtimed-nightly",
		bytes: 40_518_544,
		sha256: "f33d3a9919be7993f255ba271a2b07e278d3a3bc276a70566b77dd2bd6d192ce",
	},
	{
		target: "linux-x64",
		platform: "linux",
		arch: "x64",
		assetName: "runtimed-nightly-linux-x64",
		executable: "runtimed-nightly",
		bytes: 41_957_008,
		sha256: "99a3a913dd1875313f1a7d79f4e9a04e2027b99508250dcc7509f118d411003f",
	},
	{
		target: "win32-x64",
		platform: "win32",
		arch: "x64",
		assetName: "runtimed-nightly-windows-x64.exe",
		executable: "runtimed-nightly.exe",
		bytes: 40_771_936,
		sha256: "57062f7e230905efcdbbe45fe798690c9bd0e8805a899f85b4f94b101d16ae28",
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
