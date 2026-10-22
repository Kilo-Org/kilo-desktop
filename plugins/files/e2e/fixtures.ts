import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { removePathAfterAppStops, test as shellTest } from "@kilo-desktop/e2e/fixtures";

import { FilesPage } from "./pages/files-page.js";
import { TableViewerPage } from "./pages/table-viewer-page.js";

const SYNTHETIC_PARQUET = fileURLToPath(
	new URL("../src/web/files/table-viewer/fixtures/synthetic.parquet", import.meta.url),
);

type FilesFixtures = {
	filesPage: FilesPage;
	filesWorkspace: { path: string; name: string; fileName: string; untrackedFileName: string };
	tableViewerPage: TableViewerPage;
	tableWorkspace: { path: string; name: string; csvFileName: string; parquetFileName: string };
};

function execGit(cwd: string, args: string[]): void {
	execFileSync("git", args, { cwd, stdio: "pipe" });
}

export const test = shellTest.extend<FilesFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	filesPage: async ({}, use) => {
		await use(new FilesPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	filesWorkspace: async ({}, use) => {
		const workspacePath = await mkdtemp(path.join(os.tmpdir(), "kilo-files-workspace-"));
		removePathAfterAppStops(workspacePath);
		const fileName = "files-plugin-smoke.txt";
		const untrackedFileName = "files-plugin-untracked.txt";
		await writeFile(path.join(workspacePath, fileName), "Files plugin smoke test\n");
		// A real worktree root so the files tree shows git status decorations:
		// the committed file is then modified (modified) and a second file is
		// left uncommitted (untracked). Identity is repo-local and signing is
		// disabled to stay deterministic on any developer machine.
		execGit(workspacePath, ["init", "-b", "main"]);
		execGit(workspacePath, ["config", "user.email", "files-e2e@example.com"]);
		execGit(workspacePath, ["config", "user.name", "Files E2E"]);
		execGit(workspacePath, ["add", fileName]);
		execGit(workspacePath, ["-c", "commit.gpgsign=false", "commit", "-m", "initial"]);
		await writeFile(path.join(workspacePath, fileName), "Files plugin smoke test\nmodified\n");
		await writeFile(path.join(workspacePath, untrackedFileName), "untracked\n");
		await use({
			path: workspacePath,
			name: path.basename(workspacePath),
			fileName,
			untrackedFileName,
		});
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	tableViewerPage: async ({}, use) => {
		await use(new TableViewerPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	tableWorkspace: async ({}, use) => {
		const workspacePath = await mkdtemp(path.join(os.tmpdir(), "kilo-files-tables-"));
		removePathAfterAppStops(workspacePath);
		const csvFileName = "scores.csv";
		const parquetFileName = "synthetic.parquet";
		await writeFile(path.join(workspacePath, csvFileName), "city,score\nÅre,3\nOslo,1\n");
		await copyFile(SYNTHETIC_PARQUET, path.join(workspacePath, parquetFileName));
		await use({
			path: workspacePath,
			name: path.basename(workspacePath),
			csvFileName,
			parquetFileName,
		});
	},
});

export const { expect } = test;
