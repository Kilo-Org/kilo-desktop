import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "../../../fixtures/features/chat.js";
import { removePathAfterAppStops } from "../../../fixtures/shell.js";

test.describe("Chat composer draft footer", () => {
	test("renders the draft footer, offers workspace options, and enables send after typing @smoke", async ({
		appShellPage,
		chatComposerPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatComposerPage.verifyDraftFooterVisible();
		await chatComposerPage.verifyWorkspaceSelectorVisible();
		await chatComposerPage.openWorkspaceSelector();
		await chatComposerPage.verifyUnscopedOptionVisible();
		await chatComposerPage.selectUnscopedWorkspace();
		await chatComposerPage.verifyWorkspaceSelectorLabel("Select workspace");
		await chatComposerPage.typeMessage("Composer smoke message");
		await chatComposerPage.verifySendEnabled();
	});

	test("disables send while the composer is empty", async ({ appShellPage, chatComposerPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatComposerPage.verifyDraftFooterVisible();
		await chatComposerPage.verifySendDisabled();
	});

	test("shows the trigger's icons and label, and the empty workspace picker @smoke", async ({
		appShellPage,
		chatComposerPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();
		await chatComposerPage.verifyWorkspaceTriggerLabelAndIcons();
		await chatComposerPage.openWorkspaceSelector();
		await chatComposerPage.verifyWorkspaceSearchVisible();
		await chatComposerPage.verifyNoWorkspaceOptionSelected();
		await chatComposerPage.verifyNoWorkspacesYetMessage();
		await chatComposerPage.verifyNewWorkspaceOptionVisible();
	});

	test("lists every existing workspace with its name once workspaces exist @smoke", async ({
		appShellPage,
		chatComposerPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await chatComposerPage.openDraft();

		// Random, unique names/folders per run: the picker must render whatever
		// workspaces actually exist, not a fixed fixture list. Folder removal is
		// deferred until the app stops (Windows holds open handles), mirroring
		// fixtures/features/workspace.ts's watchedFolder.
		const createdWorkspaceIds: string[] = [];
		const workspaceNames: string[] = [];
		for (let index = 0; index < 2; index += 1) {
			const rawPath = await mkdtemp(path.join(os.tmpdir(), "kilo-composer-workspace-"));
			const folderPath = await realpath(rawPath);
			removePathAfterAppStops(rawPath);
			removePathAfterAppStops(folderPath);
			const workspaceName = path.basename(folderPath);
			const workspaceId = await chatComposerPage.createWorkspace(folderPath, workspaceName);
			createdWorkspaceIds.push(workspaceId);
			workspaceNames.push(workspaceName);
		}

		await chatComposerPage.openWorkspaceSelector();
		await chatComposerPage.verifyNoWorkspacesYetMessageHidden();
		for (const workspaceName of workspaceNames) {
			await chatComposerPage.verifyWorkspaceRowVisible(workspaceName);
		}

		for (const workspaceId of createdWorkspaceIds) {
			await chatComposerPage.removeWorkspace(workspaceId);
		}
	});
});
