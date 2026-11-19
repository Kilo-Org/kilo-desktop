import { mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MainProcessErrors } from "../pages/terminal/main-process-errors.js";
import { TerminalPage } from "../pages/terminal/terminal-page.js";
import { TerminalSettingsPage } from "../pages/terminal/terminal-settings-page.js";
import { removePathAfterAppStops, test as shellTest } from "./shell.js";

type TerminalFixtures = {
	terminalPage: TerminalPage;
	terminalSettingsPage: TerminalSettingsPage;
	terminalWorkspace: { path: string; name: string };
	mainProcessErrors: MainProcessErrors;
};

export const test = shellTest.extend<TerminalFixtures>({
	// Terminal smoke coverage creates persistent sessions, panes and shells.
	// Give that stateful flow its own app/profile instead of inheriting another
	// spec's worker-scoped state.
	appIsolationKey: "terminal",
	appLaunchEnv:
		process.platform === "win32"
			? {}
			: {
					BASH_ENV: "",
					ENV: "",
					SHELL: "/bin/sh",
				},
	mainProcessErrors: async ({ sharedApp }, use) => {
		await use(new MainProcessErrors(sharedApp.log));
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	terminalPage: async ({}, use) => {
		await use(new TerminalPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	terminalSettingsPage: async ({}, use) => {
		await use(new TerminalSettingsPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	terminalWorkspace: async ({}, use) => {
		// kilo.work-sessions stores folders by their realpath (macOS temp dirs
		// are /var → /private/var symlinks), and terminals start only in those.
		const rawPath = await mkdtemp(path.join(os.tmpdir(), "kilo-terminal-workspace-"));
		const workspacePath = await realpath(rawPath);
		removePathAfterAppStops(rawPath);
		removePathAfterAppStops(workspacePath);
		await use({ path: workspacePath, name: path.basename(workspacePath) });
	},
});

export const { expect } = test;
