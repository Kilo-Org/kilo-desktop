import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { test } from "../fixtures.js";

test.use({ appIsolationKey: "files" });

test.describe("Files @packaged", () => {
	test("opens the bundled files pane and exposes a workspace file", async ({
		appShellPage,
		filesPage,
		filesWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await filesPage.createAndSelectWorkspace(filesWorkspace.path, filesWorkspace.name);
		await filesPage.openFilesPane();
		await filesPage.verifyFileIsExposed(filesWorkspace.fileName);
	});

	test("shows git status decorations for a worktree-root workspace", async ({
		appShellPage,
		filesPage,
		filesWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await filesPage.createAndSelectWorkspace(filesWorkspace.path, filesWorkspace.name);
		await filesPage.openFilesPane();
		await filesPage.verifyFileHasGitStatus(filesWorkspace.fileName, "modified");
		await filesPage.verifyFileHasGitStatus(filesWorkspace.untrackedFileName, "untracked");
	});

	test("auto-refreshes the tree when files change on disk @smoke", async ({
		appShellPage,
		filesPage,
		filesWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await filesPage.createAndSelectWorkspace(filesWorkspace.path, filesWorkspace.name);
		await filesPage.openFilesPane();

		const fileName = "files-plugin-auto-refresh.txt";
		await writeFile(path.join(filesWorkspace.path, fileName), "added by the e2e test\n");
		await filesPage.verifyFileIsExposed(fileName);

		await rm(path.join(filesWorkspace.path, fileName));
		await filesPage.verifyFileIsNotExposed(fileName);
	});

	test("reloads an open file when it changes on disk", async ({
		appShellPage,
		filesPage,
		filesWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await filesPage.createAndSelectWorkspace(filesWorkspace.path, filesWorkspace.name);
		await filesPage.openFilesPane();
		await filesPage.clickFileInTree(filesWorkspace.fileName);

		// Modify the file externally; the watcher, debounce, and refetch are
		// absorbed by the default assertion timeout.
		await writeFile(
			path.join(filesWorkspace.path, filesWorkspace.fileName),
			"auto-reload-marker\n",
		);
		await filesPage.expectEditorToContain(filesWorkspace.fileName, "auto-reload-marker");
	});
});
