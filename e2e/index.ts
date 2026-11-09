/**
 * Public entry for plugin e2e suites.
 *
 * Plugins import `test` / `expect` from `@kilo-desktop/e2e` and
 * extend with their own page objects — see .agents/skills/write-e2e-test/SKILL.md.
 */
export { electronFixture, waitForMainWindow } from "./fixtures/electron.js";
export { expect, test } from "./fixtures/shell.js";
export { openNewChatDraft, selectDraftWorkspace } from "./pages/features/chat/new-chat-draft.js";
export { packagedAppLaunchEnv } from "./utils/app-launcher.js";
export { packagedExecutable, packagedResourcesDirectory } from "./utils/paths.js";
