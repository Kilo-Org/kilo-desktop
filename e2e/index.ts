/**
 * Public entry for plugin e2e suites.
 *
 * Plugins import `test` / `expect` from `@kilo-desktop/e2e` and
 * extend with their own page objects — see .agents/skills/write-e2e-test/SKILL.md.
 */
export {
	electronFixture,
	removePathAfterAppStops,
	waitForMainWindow,
} from "./fixtures/electron.js";
export { expect, test } from "./fixtures/shell.js";
export { runFromCommandPalette } from "./pages/shell/command-palette.js";
export { packagedAppLaunchEnv } from "./utils/app-launcher.js";
export { packagedExecutable, packagedResourcesDirectory } from "./utils/paths.js";
export {
	callDomainObject,
	readDomainObjectState,
	readMainSnapshot,
	waitForDomainObjectState,
	WINDOW_KERNEL_CALLER,
	type MainSnapshot,
} from "./utils/kernel-bridge.js";
