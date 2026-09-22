import { test } from "../fixtures.js";

test.describe("Terminal @smoke @packaged", () => {
	test("runs isolated shells in repeatable grid panes", async ({
		appShellPage,
		terminalPage,
		terminalWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await terminalPage.createAndSelectWorkspace(terminalWorkspace.path, terminalWorkspace.name);

		const first = await terminalPage.openFirstTerminal();
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

		await terminalPage.exit(second);
	});
});
