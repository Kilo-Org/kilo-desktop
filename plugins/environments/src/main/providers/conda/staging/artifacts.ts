export interface MinicondaInstallerArtifact {
	readonly target: string;
	readonly platform: NodeJS.Platform;
	readonly arch: NodeJS.Architecture;
	readonly installerUrl: string;
	readonly installerSha256: string;
	readonly condaBinRelPath: string;
}

/**
 * Pinned Miniconda installer: Miniconda3-py39_25.9.1-3.
 * SHA256 digests sourced from https://repo.anaconda.com/miniconda/.
 * Bumping the pin is a small PR: update URLs + SHA256s + re-verify.
 */
export const MINICONDA_ARTIFACTS: readonly MinicondaInstallerArtifact[] = [
	{
		target: "darwin-arm64",
		platform: "darwin",
		arch: "arm64",
		installerUrl: "https://repo.anaconda.com/miniconda/Miniconda3-py39_25.9.1-3-MacOSX-arm64.sh",
		installerSha256: "f05dcd060e3915a0a3a9dece324d2eb88268fa251fff2fb63d48e232c5fab510",
		condaBinRelPath: "bin/conda",
	},
	{
		target: "linux-x64",
		platform: "linux",
		arch: "x64",
		installerUrl: "https://repo.anaconda.com/miniconda/Miniconda3-py39_25.9.1-3-Linux-x86_64.sh",
		installerSha256: "0ac18f10d17ca918247b4606df82be38eba6e23380a7eddb25b47ef6ccdb920e",
		condaBinRelPath: "bin/conda",
	},
	{
		target: "win32-x64",
		platform: "win32",
		arch: "x64",
		installerUrl: "https://repo.anaconda.com/miniconda/Miniconda3-py39_25.9.1-3-Windows-x86_64.exe",
		installerSha256: "d2c7dc0cb900b8838f262c08bf3e0c1e537b638cddf63a696dc3db9cb3d75a95",
		condaBinRelPath: "Scripts\\conda.exe",
	},
] as const satisfies readonly MinicondaInstallerArtifact[];

export function getMinicondaInstaller(
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
): MinicondaInstallerArtifact {
	const artifact = MINICONDA_ARTIFACTS.find((a) => a.platform === platform && a.arch === arch);
	if (!artifact) {
		throw new Error(`Miniconda installer not configured for ${platform}/${arch}.`);
	}
	return artifact;
}
