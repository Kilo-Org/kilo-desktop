import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect } from "@playwright/test";

import { test } from "../fixtures.js";

test.describe("Notebook @smoke", () => {
	test("creates, executes, isolates, and saves Kilo sidecar notebooks", async ({
		electronApp,
		notebookPage,
	}) => {
		const saveDirectory = await mkdtemp(path.join(os.tmpdir(), "aad-notebook-save-"));
		const savePath = path.join(saveDirectory, "kilo-sidecar.ipynb");
		await electronApp.evaluate(({ dialog }, selectedPath) => {
			type MutableDialog = { showSaveDialog: typeof dialog.showSaveDialog };
			type NotebookGlobals = typeof globalThis & {
				__notebookOriginalShowSaveDialog?: typeof dialog.showSaveDialog;
			};
			const globals = globalThis as NotebookGlobals;
			globals.__notebookOriginalShowSaveDialog ??= dialog.showSaveDialog;
			(dialog as MutableDialog).showSaveDialog = async () => ({
				canceled: false,
				filePath: selectedPath,
			});
		}, savePath);

		try {
			await notebookPage.openKiloChat();
			await notebookPage.addTwoNotebooks();
			await notebookPage.verifyDistinctProtocolFramesAndSwitching();
			await notebookPage.verifyBundledResources();
			await notebookPage.verifyStatusChannelReportsSingleton();
			await notebookPage.verifyDaemonIsReachable();
			await notebookPage.executeCellAndVerifyOutput();
			await notebookPage.executeIsolatedJavaScriptOutput();
			await notebookPage.saveCurrentNotebook(savePath);
			const savedNotebook = JSON.parse(await readFile(savePath, "utf8")) as {
				cells?: Array<{ source?: string[] }>;
			};
			expect(savedNotebook.cells?.[0]?.source?.join("")).toContain("electron-csp-js-output");
		} finally {
			await electronApp.evaluate(({ dialog }) => {
				type NotebookGlobals = typeof globalThis & {
					__notebookOriginalShowSaveDialog?: typeof dialog.showSaveDialog;
				};
				const globals = globalThis as NotebookGlobals;
				if (globals.__notebookOriginalShowSaveDialog) {
					(dialog as { showSaveDialog: typeof dialog.showSaveDialog }).showSaveDialog =
						globals.__notebookOriginalShowSaveDialog;
					delete globals.__notebookOriginalShowSaveDialog;
				}
			});
			await rm(saveDirectory, { recursive: true, force: true });
		}
	});

	test("restores an unsaved notebook after an app restart", async ({
		notebookPage,
		restartableNotebookApp,
	}) => {
		await notebookPage.openKiloChat();
		test.skip(
			!(await notebookPage.runtimeIsAvailable()),
			"The packaged notebook runtime is not available in this build.",
		);
		await notebookPage.createPersistentChat();
		const source = "recover_me_after_restart = 1729";
		const chatTitle = `Notebook recovery ${String(Date.now())}`;
		await notebookPage.openNotebookAndWriteSource(source);
		await notebookPage.renameCurrentChat(chatTitle);

		await restartableNotebookApp.restart();
		await notebookPage.openKiloChat();
		await notebookPage.openChat(chatTitle);

		await notebookPage.verifyRecoveredSource(source);
	});
});
