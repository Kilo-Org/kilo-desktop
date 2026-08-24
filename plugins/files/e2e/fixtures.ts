import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test as shellTest } from "@anaconda-agentic-desktop/e2e/fixtures";

import { FilesPage } from "./pages/files-page.js";

type FilesFixtures = {
	filesPage: FilesPage;
	filesWorkspace: { path: string; name: string; fileName: string };
};

export const test = shellTest.extend<FilesFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	filesPage: async ({}, use) => {
		await use(new FilesPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	filesWorkspace: async ({}, use) => {
		const workspacePath = await mkdtemp(path.join(os.tmpdir(), "aad-files-workspace-"));
		const fileName = "files-plugin-smoke.txt";
		await writeFile(path.join(workspacePath, fileName), "Files plugin smoke test\n");
		await use({ path: workspacePath, name: path.basename(workspacePath), fileName });
		await rm(workspacePath, { recursive: true, force: true });
	},
});

export const { expect } = test;
