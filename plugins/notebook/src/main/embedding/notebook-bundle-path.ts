import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Validates the nteract SPA directory resolved by the plugin-aware host SDK.
 */
export interface NotebookBundlePathOptions {
	readonly candidate: string;
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
	// index.html is what the bundle is useless without, so its absence means the
	// directory exists but holds no servable bundle.
	return exists(path.join(options.candidate, "index.html")) ? options.candidate : undefined;
}
