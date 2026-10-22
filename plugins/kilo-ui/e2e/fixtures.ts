import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { removePathAfterAppStops, test as shellTest } from "@kilo-desktop/e2e/fixtures";

import { AgentToolsPage } from "./pages/agent-tools-page.js";
import { ExternalAiAppsPage } from "./pages/external-ai-apps-page.js";
import { KiloCodePage } from "./pages/kilo-code-page.js";
import { LayoutPresetsPage } from "./pages/layout-presets-page.js";
import { KiloProvidersPage } from "./pages/kilo-providers-page.js";
import { LocalProvidersPage } from "./pages/local-providers-page.js";
import { OnboardingPage } from "./pages/onboarding-page.js";
import { WorkspaceBoardPage } from "./pages/workspace-board-page.js";
import { WorkspacesPage } from "./pages/workspaces-page.js";
import { GitWorktreesPage, initializeGitRepository } from "./pages/git-worktrees-page.js";

type KiloUiFixtures = {
	agentToolsPage: AgentToolsPage;
	externalAiAppsPage: ExternalAiAppsPage;
	kiloCodePage: KiloCodePage;
	layoutPresetsPage: LayoutPresetsPage;
	kiloProvidersPage: KiloProvidersPage;
	localProvidersPage: LocalProvidersPage;
	onboardingPage: OnboardingPage;
	workspaceBoardPage: WorkspaceBoardPage;
	workspacesPage: WorkspacesPage;
	workspaceFolder: { path: string; name: string };
	gitWorktreesPage: GitWorktreesPage;
	gitRepoFolder: { path: string; name: string };
};

export const test = shellTest.extend<KiloUiFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	agentToolsPage: async ({}, use) => {
		await use(new AgentToolsPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	externalAiAppsPage: async ({}, use) => {
		await use(new ExternalAiAppsPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	layoutPresetsPage: async ({}, use) => {
		await use(new LayoutPresetsPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	workspaceFolder: async ({}, use) => {
		const folderPath = await mkdtemp(path.join(os.tmpdir(), "kilo-ui-workspace-"));
		removePathAfterAppStops(folderPath);
		await use({ path: folderPath, name: path.basename(folderPath) });
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	gitRepoFolder: async ({}, use) => {
		const repoPath = await mkdtemp(path.join(os.tmpdir(), "aad-git-worktree-repo-"));
		removePathAfterAppStops(repoPath);
		await initializeGitRepository(repoPath);
		await use({ path: repoPath, name: path.basename(repoPath) });
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	gitWorktreesPage: async ({}, use) => {
		await use(new GitWorktreesPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	kiloCodePage: async ({}, use) => {
		await use(new KiloCodePage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	kiloProvidersPage: async ({}, use) => {
		await use(new KiloProvidersPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	localProvidersPage: async ({}, use) => {
		await use(new LocalProvidersPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	onboardingPage: async ({}, use) => {
		await use(new OnboardingPage());
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	workspaceBoardPage: async ({}, use) => {
		const workspaceBoardPage = new WorkspaceBoardPage();
		await use(workspaceBoardPage);
		// The worker's app outlives the test: a board left popped out would hide the
		// board, and its title-bar actions, from every later test and retry.
		await workspaceBoardPage.closeBoardWindows();
	},
	workspacesPage: async ({ electronApp, workspaceFolder }, use) => {
		await electronApp.evaluate(({ dialog }, selectedPath) => {
			type MutableDialog = {
				showOpenDialog: typeof dialog.showOpenDialog;
			};
			type WorkspaceGlobals = typeof globalThis & {
				__workspaceOriginalShowOpenDialog?: typeof dialog.showOpenDialog;
			};
			const globals = globalThis as WorkspaceGlobals;
			globals.__workspaceOriginalShowOpenDialog ??= dialog.showOpenDialog;
			(dialog as MutableDialog).showOpenDialog = async () => ({
				canceled: false,
				filePaths: [selectedPath],
				bookmarks: [],
			});
		}, workspaceFolder.path);

		await use(new WorkspacesPage());

		await electronApp.evaluate(({ dialog }) => {
			type WorkspaceGlobals = typeof globalThis & {
				__workspaceOriginalShowOpenDialog?: typeof dialog.showOpenDialog;
			};
			const globals = globalThis as WorkspaceGlobals;
			if (globals.__workspaceOriginalShowOpenDialog) {
				(dialog as { showOpenDialog: typeof dialog.showOpenDialog }).showOpenDialog =
					globals.__workspaceOriginalShowOpenDialog;
				delete globals.__workspaceOriginalShowOpenDialog;
			}
		});
	},
});

export const { expect } = test;
