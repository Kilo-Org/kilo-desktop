import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chatFileMentionData } from "../../testdata/chat/file-mentions.js";
import { test as chatTest } from "../chat.js";
import { removePathAfterAppStops } from "../shell.js";

type FileMentionWorkspace = {
	readonly path: string;
	readonly name: string;
	readonly fileName: string;
};

type FileMentionFixtures = {
	fileMentionWorkspace: FileMentionWorkspace;
};

export const test = chatTest.extend<FileMentionFixtures>({
	appIsolationKey: "chat-file-mentions",
	fileMentionWorkspace: async ({ appShellPage: _appShellPage }, use) => {
		// kilo.work-sessions stores folders by their realpath (macOS temp dirs are
		// /var → /private/var symlinks). Removal waits for the app to stop.
		const rawPath = await mkdtemp(path.join(os.tmpdir(), "kilo-chat-file-mention-"));
		const workspacePath = await realpath(rawPath);
		removePathAfterAppStops(rawPath);
		removePathAfterAppStops(workspacePath);
		await writeFile(
			path.join(workspacePath, chatFileMentionData.fileName),
			chatFileMentionData.content,
		);
		await use({
			path: workspacePath,
			name: path.basename(workspacePath),
			fileName: chatFileMentionData.fileName,
		});
	},
});

export const { expect } = test;
