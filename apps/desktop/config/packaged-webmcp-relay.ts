import path from "node:path";

import { PACKAGED_WEBMCP_RELAY_DIRECTORY } from "@kilo-desktop/plugin-kilo-server/packaged-assets";

/**
 * `packageAfterCopy`'s `buildPath` is packager's `originalResourcesAppDir`
 * (`…/resources/app`), which is then packed wholesale into `app.asar`.
 * Extra resources and `process.resourcesPath` live one directory up, so the
 * relay must be staged as a sibling of `app`/`app.asar`, not inside it.
 */
export function resolvePackagedWebMcpRelayDirectory(appDirectory: string): string {
	return path.join(path.dirname(appDirectory), PACKAGED_WEBMCP_RELAY_DIRECTORY);
}
