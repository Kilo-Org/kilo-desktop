import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAppIdentity } from "../../apps/desktop/config/app-identity.js";
import { daemonAssetName, daemonChannel } from "../../apps/desktop/config/daemon-asset.js";
import { getReleaseChannel } from "../../apps/desktop/config/release.js";

const thisDirectory = path.dirname(fileURLToPath(import.meta.url));
const identity = getAppIdentity(getReleaseChannel(process.env));

/** Repository root (parent of the e2e/ package). */
export const repoRoot = path.resolve(thisDirectory, "../..");

const packageDirectory = path.join(
	repoRoot,
	"apps/desktop/out",
	`${identity.productName}-${process.platform}-${process.arch}`,
);

/** Packaged Electron binary produced by `electron-forge package`. */
export function packagedExecutable(): string {
	switch (process.platform) {
		case "darwin":
			return path.join(
				packageDirectory,
				`${identity.productName}.app/Contents/MacOS/${identity.productName}`,
			);
		case "win32":
			return path.join(packageDirectory, `${identity.executableName}.exe`);
		default:
			return path.join(packageDirectory, identity.executableName);
	}
}

/** Where `extraResource` lands staged sidecars — what `process.resourcesPath` is at runtime. */
function packagedResources(): string {
	return process.platform === "darwin"
		? path.join(packageDirectory, `${identity.productName}.app/Contents/Resources`)
		: path.join(packageDirectory, "resources");
}

/**
 * Whether the app under test actually shipped a `runtimed` sidecar.
 *
 * Staging is opt-in via `RUNTIMED_BINARY`, which CI does not set, so a build with
 * no daemon is a supported configuration rather than a failure. Tests that assert
 * daemon behavior have to ask this first, and the answer has to come from disk:
 * `notebook:status` reports the same `failed` state for "none bundled" as for "a
 * bundled one that would not start", and only the latter is a regression.
 */
export function packagedDaemonExists(): boolean {
	return existsSync(path.join(packagedResources(), daemonAssetName(daemonChannel(process.env))));
}
