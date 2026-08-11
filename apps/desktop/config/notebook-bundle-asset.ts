import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Stages nteract's built SPA so the packager can copy it into the app bundle.
 *
 * The bundle is a plain directory of static assets (`index.html` plus a
 * content-hashed `assets/` tree) built out of nteract's own repo. Until it is
 * published as a release asset, the source is a local path supplied via
 * `NTERACT_BUNDLE`. The app stages web assets but attaches to an externally
 * installed runtimed singleton.
 *
 * Staging has to happen before `forge.config.ts` builds `extraResource`, which
 * it does at module load — hence a `prepackage` script rather than a Forge hook.
 */

/**
 * Where the staged bundle waits for the packager, relative to `apps/desktop`.
 * Gitignored build output, not a tracked asset.
 */
export const NOTEBOOK_BUNDLE_STAGING_DIRECTORY = "build/notebook";

export interface NotebookBundleEnvironment {
	readonly NTERACT_BUNDLE?: string | undefined;
}

/**
 * Rejects a source that is not a built SPA. A path pointing at nteract's repo
 * root, or a half-finished copy, would otherwise ship and fail only when the
 * notebook is opened — as a blank frame rather than a build error.
 */
export async function isNotebookBundle(directory: string): Promise<boolean> {
	const indexPath = path.join(directory, "index.html");
	try {
		if (!(await stat(indexPath)).isFile()) return false;
	} catch {
		return false;
	}
	// nteract's Vite config uses `base: "/"`, so the shell references its entry
	// chunk absolutely. No such reference means this is not the built output.
	return (await readFile(indexPath, "utf8")).includes("/assets/");
}

export interface StageNotebookBundleOptions {
	readonly destinationDirectory: string;
	readonly environment?: NotebookBundleEnvironment;
}

/**
 * Copies the bundle into `destinationDirectory` and returns its path, or
 * undefined when no source is configured. A missing bundle is not fatal: the
 * app serves 404 for the notebook host and the view shows a placeholder, so an
 * unconfigured local build still packages and runs.
 */
export async function stageNotebookBundle(
	options: StageNotebookBundleOptions,
): Promise<string | undefined> {
	const environment = options.environment ?? process.env;
	const source = environment.NTERACT_BUNDLE?.trim();

	// Clear a bundle staged by an earlier build so an unset NTERACT_BUNDLE cannot
	// silently ship a stale UI — which would skew against the staged daemon with
	// nothing to catch it (D6).
	await rm(options.destinationDirectory, { recursive: true, force: true });
	if (!source) return undefined;

	if (!(await isNotebookBundle(source))) {
		throw new Error(
			`NTERACT_BUNDLE at ${source} is not a built notebook bundle (no index.html referencing /assets/). Point it at nteract's apps/notebook/dist.`,
		);
	}

	await mkdir(options.destinationDirectory, { recursive: true });
	await cp(source, options.destinationDirectory, { recursive: true });
	return options.destinationDirectory;
}
