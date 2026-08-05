import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test as shellTest } from "@anaconda-agentic-desktop/e2e/fixtures";

import { KiloCodePage } from "./pages/kilo-code-page.js";

type KiloCodeFixtures = {
	kiloCodePage: KiloCodePage;
	workspaceFolder: { path: string; name: string };
};

export const test = shellTest.extend<KiloCodeFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	workspaceFolder: async ({}, use) => {
		const folderPath = await mkdtemp(path.join(os.tmpdir(), "aad-kilo-workspace-"));
		await use({ path: folderPath, name: path.basename(folderPath) });
		await rm(folderPath, { recursive: true, force: true });
	},
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	kiloCodePage: async ({}, use) => {
		await use(new KiloCodePage());
	},
});

export const { expect } = test;
