import { test } from "../../fixtures/chat/workspace-picker.js";

const FIRST_MESSAGE = "Workspace picker first message";

test.describe("Chat welcome workspace picker", () => {
	test("selects, switches and clears a workspace before the first message @smoke @packaged", async ({
		appShellPage,
		chatComposerPage,
		newChatPage,
		workspacePickerWorkspaces: [firstWorkspace, selectedWorkspace],
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await newChatPage.openNewSessionPage();

		await newChatPage.selectWorkspace(firstWorkspace.name);
		await newChatPage.verifySelectedWorkspace(firstWorkspace.name);
		await newChatPage.selectWorkspace(selectedWorkspace.name);
		await newChatPage.verifySelectedWorkspace(selectedWorkspace.name);

		await newChatPage.clearWorkspace();
		await newChatPage.verifyNoWorkspaceSelected();
		await newChatPage.selectWorkspace(selectedWorkspace.name);
		await newChatPage.verifySelectedWorkspace(selectedWorkspace.name);

		await chatComposerPage.send(FIRST_MESSAGE);
		await chatComposerPage.verifyChatStarted(FIRST_MESSAGE);
		await chatComposerPage.verifySessionInWorkspace(selectedWorkspace.name);
	});
});
