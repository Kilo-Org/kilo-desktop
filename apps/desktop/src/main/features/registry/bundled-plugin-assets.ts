import { createRequire } from "node:module";
import path from "node:path";

/**
 * Build a `BundledPlugin.resolveAsset` that maps a subpath inside the plugin
 * package (e.g. `"drizzle"`, `"seeds/en.json"`) to an absolute filesystem
 * path, working across every layout the app runs in:
 *
 * - source (tests, tooling): the plugin package resolves through pnpm's
 *   `node_modules` symlink to the workspace source tree.
 * - bundled (`pnpm dev`) and packaged app: the plugin ships into the app's
 *   `node_modules` via `pnpm deploy`.
 *
 * Anchors on `plugin.json` because that subpath is always exported and its
 * location is the same "package root" the plugin ships assets alongside.
 * Throws once at resolution time with the missing subpath rather than
 * letting the plugin fail downstream with an opaque error.
 */
export function bundledPluginAssetResolver(packageName: string): (subpath: string) => string {
	// createRequire uses this file's URL as the resolution anchor so the
	// package graph seen matches this bundle's node_modules layout.
	const require = createRequire(import.meta.url);
	return (subpath) => {
		let manifestPath: string;
		try {
			manifestPath = require.resolve(`${packageName}/plugin.json`);
		} catch (cause) {
			throw new Error(
				`bundledPluginAssetResolver: cannot resolve "${packageName}/plugin.json" — is the plugin package installed?`,
				{ cause },
			);
		}
		return path.resolve(path.dirname(manifestPath), subpath);
	};
}
