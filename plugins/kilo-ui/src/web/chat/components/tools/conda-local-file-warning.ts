/**
 * Detects the signature of a **local package file install** in free text — an
 * agent question option, or a pending `bash` command — so the UI can warn that
 * it bypasses the Desktop guardrail.
 *
 * The managed conda tools refuse local-file package specs, so an agent that
 * still wants to install one has to shell out to `conda`/`mamba`/`micromamba`
 * or `pip`. That path skips the tool gate and runs the package's install
 * scripts directly, which is exactly what the user must be warned about at the
 * moment they are offered or asked to approve it.
 *
 * Both signatures are deliberately narrow, because routine commands must stay
 * quiet:
 *
 * - **conda family** — a conda-family token, an install intent, **and** a local
 *   package artifact (a named `.tar.bz2`/`.conda` file or a `file:` URI)
 *   anywhere in the text. Matching on a bare "local file" phrase would misfire
 *   on the *safe* option, whose description often mentions the local file it
 *   is replacing; a bare `.conda` is the workspace environment directory, so
 *   `test -x .conda/bin/python` is not an install.
 * - **pip** — a `pip install` whose own arguments name a local package archive
 *   (a wheel or sdist, by path or `file:` URI) or a local `--find-links`
 *   location. Installing by name or remote URL, setting up a project from its
 *   source directory (`pip install -e .`), and paths that are not package
 *   sources (`-r requirements.txt`, `cd`, redirections, comments) stay quiet.
 *
 * Commands are read in POSIX and Windows syntax alike: drive, UNC and
 * `%VAR%`/`$env:` paths, `pip.exe`, and `\`, `` ` `` and `^` continuations.
 */

const CONDA_FAMILY_CLI = /\b(?:conda|mamba|micromamba)\b/i;
const INSTALL_INTENT = /\b(?:install|create|update)/i;
// A package file has a name before its extension; a bare `.conda` is an
// environment directory (`<workspace>/.conda`, `~/.conda/envs`).
const LOCAL_CONDA_ARTIFACT = /[\w-]\.conda\b|\.tar\.bz2\b|file:\/\//i;

// bash `\`, PowerShell `` ` `` and cmd `^` line continuations.
const LINE_CONTINUATION = /[\\`^]\r?\n/g;
// The arguments of each `pip install` (also `pip3`, `pip.exe`, a quoted pip
// path, `python -m pip`, `py -m pip`, `uv pip`), up to the end of that command.
const PIP_INSTALL_ARGS = /\bpip(?:\d+(?:\.\d+)*)?(?:\.exe)?["']?\s+install[ \t]([^\r\n;|&`]*)/gi;
const OPTION_ASSIGNMENT = /^(-[^=]+)=(.+)$/;
// Options whose value is a directory (or page) of package files to install from.
const PIP_FIND_LINKS = new Set(["-f", "--find-links"]);
const FILE_URL = /\bfile:\//i;
const REMOTE_URL = /[a-z][\w+.-]+:\/\//i;
const PACKAGE_ARCHIVE = /\.(?:whl|zip|tar|tgz|tbz|txz|tar\.(?:gz|bz2|xz))\b/i;

export const LOCAL_CONDA_FILE_INSTALL_WARNING =
	"High risk — installing a local package file bypasses the Desktop security " +
	"guardrail and is not recommended. Install from a channel instead.";

/**
 * Returns the guardrail-bypass warning when `text` describes installing a local
 * package file with the conda family CLI or pip, otherwise `undefined`.
 */
export function localCondaFileInstallWarning(text: string | undefined): string | undefined {
	if (!text) return undefined;
	const condaInstallsLocalFile =
		CONDA_FAMILY_CLI.test(text) && INSTALL_INTENT.test(text) && LOCAL_CONDA_ARTIFACT.test(text);
	return condaInstallsLocalFile || pipInstallsLocalPackageFile(text)
		? LOCAL_CONDA_FILE_INSTALL_WARNING
		: undefined;
}

function pipInstallsLocalPackageFile(text: string): boolean {
	const commands = text.replace(LINE_CONTINUATION, " ");
	return Array.from(commands.matchAll(PIP_INSTALL_ARGS)).some(([, args = ""]) =>
		pipArgsNameLocalPackageFile(args),
	);
}

function pipArgsNameLocalPackageFile(args: string): boolean {
	let previous = "";
	for (const token of args.trim().split(/\s+/)) {
		if (token.startsWith("#")) break; // the rest is a shell comment
		const [, option = previous, value = token] = OPTION_ASSIGNMENT.exec(token) ?? [];
		const local = PIP_FIND_LINKS.has(option)
			? isLocalLocation(value)
			: isLocalPackageArchive(value);
		if (local) return true;
		previous = token;
	}
	return false;
}

function isLocalLocation(location: string): boolean {
	return FILE_URL.test(location) || !REMOTE_URL.test(location);
}

function isLocalPackageArchive(spec: string): boolean {
	return PACKAGE_ARCHIVE.test(spec) && isLocalLocation(spec);
}
