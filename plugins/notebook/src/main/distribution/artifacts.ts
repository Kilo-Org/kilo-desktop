/** Pinned nteract release used for both the daemon and notebook UI. */
export const NTERACT_RELEASE = {
	tag: "v2.6.3-nightly.202608112303",
	commit: "6261fa1fc8814edb759b43fbc1ac24ce8edfb297",
	repository: "https://github.com/nteract/nteract.git",
} as const;

export interface RuntimedArtifact {
	readonly target: string;
	readonly platform: NodeJS.Platform;
	readonly arch: NodeJS.Architecture;
	readonly assetName: string;
	readonly executable: string;
	readonly bytes: number;
	readonly sha256: string;
}

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
] as const satisfies readonly RuntimedArtifact[];

export function getRuntimedArtifact(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): RuntimedArtifact {
	const artifact = RUNTIMED_ARTIFACTS.find(
		(candidate) => candidate.platform === platform && candidate.arch === arch,
	);
	if (!artifact) {
		throw new Error(`runtimed is not configured for ${platform}/${arch}`);
	}
	return artifact;
}

export function runtimedDownloadUrl(artifact: RuntimedArtifact): string {
	return `https://github.com/nteract/nteract/releases/download/${NTERACT_RELEASE.tag}/${artifact.assetName}`;
}
