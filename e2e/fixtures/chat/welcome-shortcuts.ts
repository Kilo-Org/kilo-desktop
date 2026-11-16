import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { BrowserPage } from "../../pages/browser/browser-page.js";
import { NewChatPage } from "../../pages/chat/new-chat-page.js";
import { FilesPage } from "../../pages/files/files-page.js";
import { NotebookPage } from "../../pages/notebook/notebook-page.js";
import { TerminalPage } from "../../pages/terminal/terminal-page.js";
import { removePathAfterAppStops, test as shellTest } from "../shell.js";

type WelcomeShortcutFixtures = {
	newChatPage: NewChatPage;
	browserPage: BrowserPage;
	filesPage: FilesPage;
	notebookPage: NotebookPage;
	terminalPage: TerminalPage;
	workspace: { path: string; name: string; fileName: string };
	browserUrl: string;
};

export const test = shellTest.extend<WelcomeShortcutFixtures>({
	appIsolationKey: "welcome-shortcuts",
	appLaunchEnv: process.platform === "win32" ? {} : { BASH_ENV: "", ENV: "", SHELL: "/bin/sh" },
	newChatPage: async ({ appShellPage: _appShellPage }, use) => use(new NewChatPage()),
	browserPage: async ({ appShellPage: _appShellPage }, use) => use(new BrowserPage()),
	filesPage: async ({ appShellPage: _appShellPage }, use) => use(new FilesPage()),
	notebookPage: async ({ appShellPage: _appShellPage }, use) => use(new NotebookPage()),
	terminalPage: async ({ appShellPage: _appShellPage }, use) => use(new TerminalPage()),
	workspace: async ({ appShellPage: _appShellPage }, use) => {
		const workspacePath = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-shortcuts-")));
		removePathAfterAppStops(workspacePath);
		const fileName = "welcome-shortcut-file.txt";
		await writeFile(path.join(workspacePath, fileName), "Welcome shortcut workspace file\n");
		await use({ path: workspacePath, name: path.basename(workspacePath), fileName });
	},
	browserUrl: async ({ appShellPage: _appShellPage }, use) => {
		const server = createServer((_request, response) => {
			response.setHeader("Content-Type", "text/html");
			response.end("<!doctype html><title>Welcome Browser Page</title><main>Browser loaded</main>");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Loopback server did not bind");
			await use(`127.0.0.1:${address.port}`);
		} finally {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	},
});
