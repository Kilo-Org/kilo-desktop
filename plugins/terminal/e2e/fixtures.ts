import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { removePathAfterAppStops, test as shellTest } from "@kilo-desktop/e2e/fixtures";

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
		const workspacePath = await mkdtemp(path.join(os.tmpdir(), "kilo-terminal-workspace-"));
		removePathAfterAppStops(workspacePath);
		await use({ path: workspacePath, name: path.basename(workspacePath) });
	},
});

// Terminal smoke coverage creates persistent chats, panes, and sessions. Give
// that stateful flow its own app/profile instead of inheriting another spec's
// worker-scoped state.
test.use({
	appIsolationKey: "terminal",
	appLaunchEnv:
		process.platform === "win32"
			? {}
			: {
					BASH_ENV: "",
					ENV: "",
					SHELL: "/bin/sh",
				},
});

export const { expect } = test;
