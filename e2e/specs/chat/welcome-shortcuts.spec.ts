import { test } from "../../fixtures/chat/welcome-shortcuts.js";

test.describe("Welcome shortcuts @packaged", () => {
	test("opens a working Terminal from the welcome page @smoke", async ({
		appShellPage,
		newChatPage,
		terminalPage,
		workspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await newChatPage.openNewSessionInWorkspace(workspace.path, workspace.name);
		await newChatPage.launchTool("kilo.terminal/terminal");
		await newChatPage.verifySessionOpened();
		const terminal = await terminalPage.currentTerminalId();
		await terminalPage.run(terminal, "echo welcome-terminal-marker");
		await terminalPage.verifyOutputContains(terminal, /^welcome-terminal-marker\r?$/m);
		await terminalPage.exit(terminal);
	});

	test("opens a Browser and loads a page from the welcome page @smoke", async ({
		appShellPage,
		newChatPage,
		browserPage,
		browserUrl,
	}) => {
		test.slow();
		await appShellPage.verifyShellIsLoaded();
		await newChatPage.openNewSessionWithoutWorkspace();
		await newChatPage.launchTool("kilo.browser/browser");
		await newChatPage.verifySessionOpened();
		await browserPage.waitForGuest();
		await browserPage.navigate(browserUrl);
		await browserPage.verifyLoaded("Welcome Browser Page");
	});

	test("opens Files with an explanation when no workspace is selected", async ({
		appShellPage,
		newChatPage,
		filesPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await newChatPage.openNewSessionWithoutWorkspace();
		await newChatPage.verifyNoWorkspaceSelected();
		await newChatPage.launchTool("kilo.files/files");
		await newChatPage.verifySessionOpened();
		await filesPage.verifyNoWorkspace();
	});

	test("opens Files with the selected workspace's file list @smoke", async ({
		appShellPage,
		newChatPage,
		filesPage,
		workspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await newChatPage.openNewSessionInWorkspace(workspace.path, workspace.name);
		await newChatPage.launchTool("kilo.files/files");
		await newChatPage.verifySessionOpened();
		await filesPage.verifyFileIsExposed(workspace.fileName);
	});

	test("opens a Notebook from the welcome page", async ({
		appShellPage,
		newChatPage,
		notebookPage,
	}) => {
		test.setTimeout(360_000);
		await appShellPage.verifyShellIsLoaded();
		await newChatPage.openNewSessionWithoutWorkspace();
		await notebookPage.verifyNotebookAvailable();
		await newChatPage.launchTool("kilo.notebook/notebook");
		await newChatPage.verifySessionOpened();
		await notebookPage.verifyNotebookFrame();
	});
});
