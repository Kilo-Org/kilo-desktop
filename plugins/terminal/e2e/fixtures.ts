import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { removePathAfterAppStops, test as shellTest } from "@anaconda-agentic-desktop/e2e/fixtures";

import { TerminalPage } from "./pages/terminal-page.js";

type TerminalFixtures = {
	terminalPage: TerminalPage;
	terminalWorkspace: { path: string; name: string };
};

export const test = shellTest.extend<TerminalFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	terminalPage: async ({}, use) => {
		await use(new TerminalPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	terminalWorkspace: async ({}, use) => {
		const workspacePath = await mkdtemp(path.join(os.tmpdir(), "aad-terminal-workspace-"));
		removePathAfterAppStops(workspacePath);
		await use({ path: workspacePath, name: path.basename(workspacePath) });
	},
});

export const { expect } = test;
