/**
 * Public entry for plugin e2e suites.
 *
 * Plugins import `test` / `expect` from `@anaconda-agentic-desktop/e2e` and
 * extend with their own page objects — see .agents/skills/migrate-to-plugin/SKILL.md.
 */
export { electronFixture } from "./fixtures/electron.js";
export { expect, test } from "./fixtures/shell.js";
export { packagedResourcesDirectory } from "./utils/paths.js";
