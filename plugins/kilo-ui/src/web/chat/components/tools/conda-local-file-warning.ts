/**
 * Detects the signature of a **local-file conda install** in free text — an
 * agent question option, or a pending `bash` command — so the UI can warn that
 * it bypasses the Desktop guardrail.
 *
 * The managed conda tools refuse local-file package specs, so an agent that
 * still wants to install one has to shell out to `conda`/`mamba`/`micromamba`.
 * That path skips the tool gate and runs the package's install scripts
 * directly, which is exactly what the user must be warned about at the moment
 * they are offered or asked to approve it.
 *
 * The detector is deliberately narrow: it requires **both** a conda-family
 * token and a local package artifact (a `.tar.bz2`/`.conda` file or a `file:`
 * URI). Matching on a bare "local file" phrase would misfire on the *safe*
 * option, whose description often mentions the local file it is replacing.
 */

const CONDA_FAMILY_CLI = /\b(?:conda|mamba|micromamba)\b/i;
const LOCAL_PACKAGE_ARTIFACT = /\.(?:tar\.bz2|conda)\b|file:\/\//i;

export const LOCAL_CONDA_FILE_INSTALL_WARNING =
	"High risk — installing a local package file bypasses the Desktop security " +
	"guardrail and is not recommended. Install from a channel instead.";

/**
 * Returns the guardrail-bypass warning when `text` describes installing a local
 * conda package file, otherwise `undefined`.
 */
export function localCondaFileInstallWarning(text: string | undefined): string | undefined {
	if (!text) return undefined;
	if (!CONDA_FAMILY_CLI.test(text)) return undefined;
	if (!LOCAL_PACKAGE_ARTIFACT.test(text)) return undefined;
	return LOCAL_CONDA_FILE_INSTALL_WARNING;
}
