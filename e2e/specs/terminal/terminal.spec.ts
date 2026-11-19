import { test } from "../../fixtures/terminal.js";

test.describe("Terminal @smoke @packaged", () => {
	test("runs isolated shells in a terminal-only session", async ({
		appShellPage,
		terminalPage,
		terminalWorkspace,
		mainProcessErrors,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await terminalPage.createAndActivateWorkspace(terminalWorkspace.path, terminalWorkspace.name);

		const first = await terminalPage.startTerminalSession();
		await terminalPage.run(first, "echo terminal-one-marker");
		await terminalPage.verifyOutputContains(first, "terminal-one-marker");

		const second = await terminalPage.addTerminal();
		await terminalPage.run(second, "echo terminal-two-marker");
		await terminalPage.verifyOutputContains(second, "terminal-two-marker");
		await terminalPage.verifyOutputDoesNotContain(second, "terminal-one-marker");

		await terminalPage.exit(first);
		await terminalPage.verifyOutputContains(second, "terminal-two-marker");
		await terminalPage.run(second, "node -e \"console.log('terminal-node-finished')\"");
		await terminalPage.verifyOutputContains(second, "terminal-node-finished");

		// Closing a pane with a live shell makes main kill the PTY. On Windows with
		// the RunAsNode fuse off, the OS-ConPTY kill path forks and fails.
		const third = await terminalPage.addTerminal();
		await terminalPage.run(third, "echo terminal-close-marker");
		await terminalPage.verifyOutputContains(third, "terminal-close-marker");
		const beforeClose = mainProcessErrors.mark();
		await terminalPage.close(third);
		await mainProcessErrors.verifyPtyKillDidNotForkSince(beforeClose);

		await terminalPage.exit(second);
	});

	test("chooses the shell new terminals run in Settings", async ({
		appShellPage,
		terminalSettingsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await terminalSettingsPage.open();
		await terminalSettingsPage.verifyDefaultShell("Automatic");
		await terminalSettingsPage.verifyAutomaticOffered();
	});
});
