import { existsSync } from "node:fs";
import { posix, win32 } from "node:path";

export type CloneDestinationParam = { destinationPrefix: string } | { destinationName: string };

/** Directory name conda uses for its per-installation environments folder. */
const ENVS_DIR_NAME = "envs";

/**
 * A conda distribution root (`~/miniconda3`, `/opt/anaconda3`) is the only
 * kind of prefix that carries its own `envs/` or `pkgs/` directory; ordinary
 * environments never do.
 */
export function isCondaDistributionRoot(prefix: string): boolean {
	const path = isWindowsPath(prefix) ? win32 : posix;
	return existsSync(path.join(prefix, ENVS_DIR_NAME)) || existsSync(path.join(prefix, "pkgs"));
}

/**
 * Choose how to tell the bridge where a clone should land.
 *
 * The bridge sidecar is its own PyInstaller-bundled conda, so `destinationName`
 * resolves against *its* `envs_dirs` (payload dir / `~/.conda/envs`), never the
 * user's real distribution. We therefore send an explicit `destinationPrefix`
 * whenever the source tells us where the user's environments live:
 *
 * - Source inside an `envs/` directory (`…/miniconda3/envs/foo`) → sibling
 *   `…/miniconda3/envs/<name>`.
 * - Source is a distribution root, i.e. the base env (`/opt/miniconda3`) →
 *   `/opt/miniconda3/envs/<name>`. Deriving from the parent here would put
 *   the clone at `/opt/<name>`.
 *
 * Only a prefix that is neither — a `-p` env outside any envs dir, or a
 * filesystem root — falls back to `destinationName` and the bridge default.
 * `isDistributionRoot` is injectable so the decision stays unit-testable
 * without touching the filesystem.
 */
export function cloneDestinationParam(
	sourcePrefix: string | undefined,
	name: string,
	isDistributionRoot: (prefix: string) => boolean = isCondaDistributionRoot,
): CloneDestinationParam {
	if (!sourcePrefix) return { destinationName: name };

	const path = isWindowsPath(sourcePrefix) ? win32 : posix;
	// Stripping the trailing separator turns "/" into "" and "C:\" into "C:";
	// both are filesystem roots with no meaningful parent or envs dir.
	const normalized = path.normalize(sourcePrefix).replace(/[/\\]+$/, "");
	const parentDir = path.dirname(normalized);
	const isRoot = normalized === "" || parentDir === normalized;
	if (isRoot) return { destinationName: name };

	if (isDistributionRoot(normalized)) {
		return { destinationPrefix: path.join(normalized, ENVS_DIR_NAME, name) };
	}
	if (path.basename(parentDir) === ENVS_DIR_NAME) {
		return { destinationPrefix: path.join(parentDir, name) };
	}
	return { destinationName: name };
}

function isWindowsPath(value: string): boolean {
	return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
