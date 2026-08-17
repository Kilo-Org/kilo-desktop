/** Pinned release used for the staged notebook runtime executables. */
export const NTERACT_RELEASE = {
	tag: "v2.6.3-nightly.202608112303",
	commit: "6261fa1fc8814edb759b43fbc1ac24ce8edfb297",
	repository: "https://github.com/nteract/nteract.git",
} as const;

/** Temporary source pin until the Electron adapter is included in a stable release. */
export const NTERACT_NOTEBOOK_SOURCE = {
	tag: "quod/electron-notebook-host",
	commit: "f3bbe36e5e4bd1803ba22c4f2d81f297d3ace6e3",
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
	assetName: "nteract-nightly-darwin-arm64.app.tar.gz",
	bytes: 38_074_679,
	sha256: "65ef1d1f3d9237f6fe63edcaec11fdf9917d15b3a66f95005de5c1506118d371",
} as const satisfies ReleaseAsset;

const DARWIN_X64_APP = {
	assetName: "nteract-nightly-darwin-x64.app.tar.gz",
	bytes: 38_306_987,
	sha256: "2fd63f511e007adb5afaabd2e7a254e84f44fddf8e8ba19602853991d628654b",
} as const satisfies ReleaseAsset;

const WINDOWS_X64_INSTALLER = {
	assetName: "nteract-nightly-windows-x64.exe",
	bytes: 27_598_240,
	sha256: "8d7947596d11fef1e4360e7e5ee956121c3f8085392fd3daf5cd0234662e7074",
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
			bytes: 3_465_088,
			sha256: "2604347bf1566b16d83ab1f470a9e1a3b7cd003b2eb9f0a5470ce6901bb42867",
			source: DARWIN_ARM64_APP,
			extraction: {
				kind: "tar-gz",
				entryPath: "nteract Nightly.app/Contents/MacOS/nteract-mcp",
			},
		},
		runt: {
			executable: "runt-nightly",
			bytes: 17_749_184,
			sha256: "dc3f70d36cd29245ee9f4411e51feb9e43057d5dc51f4ffd085dad492ab3883b",
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
			bytes: 3_566_816,
			sha256: "48350e915ba736aec002710b81e7cae70403cdc6e0e4fbd7bae25d6ce39a90ea",
			source: DARWIN_X64_APP,
			extraction: {
				kind: "tar-gz",
				entryPath: "nteract Nightly.app/Contents/MacOS/nteract-mcp",
			},
		},
		runt: {
			executable: "runt-nightly",
			bytes: 19_313_744,
			sha256: "f0aff98088e426635452a98b2156800e0edb636c4c621a15b4cc1be305e0d08b",
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
			bytes: 4_072_040,
			sha256: "1fabe31b7e7ff6afcefd8a1ad0d445acf7d070a186ce66ae71e6586fd2cae820",
			source: {
				assetName: "nteract-mcp-nightly-linux-x64",
				bytes: 4_072_040,
				sha256: "1fabe31b7e7ff6afcefd8a1ad0d445acf7d070a186ce66ae71e6586fd2cae820",
			},
			extraction: { kind: "direct" },
		},
		runt: {
			executable: "runt-nightly",
			bytes: 20_997_688,
			sha256: "379a9caf5cc34617fff3bbc07dc4c532758857d82592c28176796166871436f9",
			source: {
				assetName: "runt-nightly-linux-x64",
				bytes: 20_997_688,
				sha256: "379a9caf5cc34617fff3bbc07dc4c532758857d82592c28176796166871436f9",
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
			bytes: 3_370_848,
			sha256: "2dcc6ab92135d8de1bbcb79d45e4697f4c476a97e60314059cba69dc311d339a",
			source: WINDOWS_X64_INSTALLER,
			extraction: { kind: "nsis", entryPath: "nteract-mcp.exe" },
		},
		runt: {
			executable: "runt-nightly.exe",
			bytes: 19_770_720,
			sha256: "ff09cd4583a7011489f5059274f1d47447860c43924cc19c53cf459c14b24b47",
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
		bytes: 38_087_488,
		sha256: "be0cbf7f4e320772711f0b7054430bfa3e1d40de4ef413f56d5baef30024deb1",
	},
	{
		target: "darwin-x64",
		platform: "darwin",
		arch: "x64",
		assetName: "runtimed-nightly-darwin-x64",
		executable: "runtimed-nightly",
		bytes: 40_455_920,
		sha256: "350f930303d7405113650b4d203be50408b1d2c89e4db57442ffa1f7ae1e0cda",
	},
	{
		target: "linux-x64",
		platform: "linux",
		arch: "x64",
		assetName: "runtimed-nightly-linux-x64",
		executable: "runtimed-nightly",
		bytes: 41_881_040,
		sha256: "b37c0a1188edf5d2f9fba83b8e5ac9f26c75bdfae9258225b8e8d9285b9c19ac",
	},
	{
		target: "win32-x64",
		platform: "win32",
		arch: "x64",
		assetName: "runtimed-nightly-windows-x64.exe",
		executable: "runtimed-nightly.exe",
		bytes: 40_601_440,
		sha256: "5f2fac4a194eafeb55aefdbb0b2707a749afaa6f9c8ee80830ca268cebb97d93",
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
