/** Pinned release used for the staged `runt mcp` CLI. */
export const NTERACT_RELEASE = {
	tag: "v2.6.3-nightly.202608112303",
	commit: "6261fa1fc8814edb759b43fbc1ac24ce8edfb297",
	repository: "https://github.com/nteract/nteract.git",
} as const;

/** Temporary source pin until the Electron adapter is included in a stable release. */
export const NTERACT_NOTEBOOK_SOURCE = {
	tag: "quod/electron-notebook-host",
	commit: "fcab8d5a6b0053c1d45b6352a134260115d69ec6",
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

export type RuntArtifact = NativeReleaseArtifact;

/**
 * `runt mcp` CLI — stdio MCP server that talks to the runtimed daemon.
 * The pinned nteract nightly does not publish a Windows asset yet.
 */
export const RUNT_ARTIFACTS = [
	{
		target: "darwin-arm64",
		platform: "darwin",
		arch: "arm64",
		assetName: "runt-nightly-darwin-arm64",
		executable: "runt-nightly",
		bytes: 17_749_024,
		sha256: "dbc278f0be0e976f137b2b660079c934cd7a0136b21fb4d39fd15988ff667f30",
	},
	{
		target: "darwin-x64",
		platform: "darwin",
		arch: "x64",
		assetName: "runt-nightly-darwin-x64",
		executable: "runt-nightly",
		bytes: 19_136_284,
		sha256: "326daeedbefe25461fb33bb1adb6625bdba6e463e12c467864b1e06981d01e78",
	},
	{
		target: "linux-x64",
		platform: "linux",
		arch: "x64",
		assetName: "runt-nightly-linux-x64",
		executable: "runt-nightly",
		bytes: 20_997_688,
		sha256: "379a9caf5cc34617fff3bbc07dc4c532758857d82592c28176796166871436f9",
	},
] as const satisfies readonly NativeReleaseArtifact[];

export function nteractDownloadUrl(assetName: string): string {
	return `https://github.com/nteract/nteract/releases/download/${NTERACT_RELEASE.tag}/${assetName}`;
}

export function findRuntArtifact(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): NativeReleaseArtifact | undefined {
	return RUNT_ARTIFACTS.find(
		(candidate) => candidate.platform === platform && candidate.arch === arch,
	);
}

export function getRuntArtifact(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): NativeReleaseArtifact {
	const artifact = findRuntArtifact(platform, arch);
	if (!artifact) {
		throw new Error(`runt is not configured for ${platform}/${arch}`);
	}
	return artifact;
}

export function runtDownloadUrl(artifact: NativeReleaseArtifact): string {
	return nteractDownloadUrl(artifact.assetName);
}
