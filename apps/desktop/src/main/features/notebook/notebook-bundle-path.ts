import { existsSync } from "node:fs";
import path from "node:path";

import { NOTEBOOK_BUNDLE_STAGING_DIRECTORY } from "$config/notebook-bundle-asset.js";

/**
 * Locates the staged nteract SPA on disk.
 *
 * Packaged builds get it from `extraResource`, which lands a directory as
 * `Contents/Resources/<name>/`; an unpackaged run finds it where the
 * `prepare:notebook` script staged it. Electron values are passed in rather
 * than imported so this stays unit-testable outside an Electron process.
 */
export interface NotebookBundlePathOptions {
	readonly isPackaged: boolean;
	readonly resourcesPath: string;
	/** `app.getAppPath()` — the `apps/desktop` package root when unpackaged. */
	readonly appPath: string;
	readonly exists?: (candidate: string) => boolean;
}

/**
 * Returns the bundle root, or undefined when this build ships none — not an
 * error, the same contract as a missing daemon: the host is still contributed
 * and the protocol handler serves 404 for it. Note the renderer cannot tell that
 * apart from a broken bundle today, so it frames an empty document rather than
 * showing its placeholder; see the handoff's loose ends.
 */
export function resolveNotebookBundleRoot(options: NotebookBundlePathOptions): string | undefined {
	const exists = options.exists ?? existsSync;
	const candidate = options.isPackaged
		? path.join(options.resourcesPath, "notebook")
		: path.join(options.appPath, NOTEBOOK_BUNDLE_STAGING_DIRECTORY);
	// index.html is what the bundle is useless without, so its absence means the
	// directory exists but holds no servable bundle.
	return exists(path.join(candidate, "index.html")) ? candidate : undefined;
}
