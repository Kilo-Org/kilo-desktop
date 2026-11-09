import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAppIdentity } from "../../apps/desktop/config/app-identity.js";
import { getReleaseTrack } from "../../apps/desktop/config/release.js";

const thisDirectory = path.dirname(fileURLToPath(import.meta.url));
const identity = getAppIdentity(getReleaseTrack(process.env));

/** Repository root (parent of the e2e/ package). */
export const repoRoot = path.resolve(thisDirectory, "../..");

const packageDirectory = path.join(
	repoRoot,
	"apps/desktop/out",
	`${identity.productName}-${process.platform}-${process.arch}`,
);

/** Electron Resources directory in the platform-specific packaged layout. */
export function packagedResourcesDirectory(): string {
	return process.platform === "darwin"
		? path.join(packageDirectory, `${identity.productName}.app/Contents/Resources`)
		: path.join(packageDirectory, "resources");
}

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
