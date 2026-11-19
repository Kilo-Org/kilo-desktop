import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EnvironmentsPage } from "../pages/environments/environments-page.js";
import { environmentsData } from "../testdata/environments.js";
import { removePathAfterAppStops } from "./shell.js";
import { test as settingsTest } from "./shell/settings.js";

/** The worker's conda folders: `envsDir` is conda's first envs directory and holds the seed. */
export type CondaSandbox = { envsDir: string; pkgsDir: string };

async function createCondaSandbox(): Promise<CondaSandbox> {
	// The bridge reports realpaths (macOS temp dirs are /var → /private/var symlinks).
	const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-e2e-conda-")));
	removePathAfterAppStops(root);
	const envsDir = path.join(root, "envs");
	// conda treats any folder with `conda-meta/history` as an (empty) environment.
	const seededMeta = path.join(envsDir, environmentsData.seededEnvName, "conda-meta");
	await mkdir(seededMeta, { recursive: true });
	await writeFile(path.join(seededMeta, "history"), "");
	return { envsDir, pkgsDir: path.join(root, "pkgs") };
}

export const test = settingsTest.extend<
	{ environmentsPage: EnvironmentsPage },
	{ condaSandbox: CondaSandbox }
>({
	// Its own worker: the bundled conda bridge inherits these, so new environments land in the
	// sandbox and are never registered in the developer's `~/.conda/environments.txt`. HOME stays
	// intact — overriding it stops the Kilo server from starting, which leaves sign-in pending.
	appIsolationKey: "environments",
	condaSandbox: [
		// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
		async ({}, use) => {
			await use(await createCondaSandbox());
		},
		{ scope: "worker" },
	],
	appLaunchEnv: [
		async ({ condaSandbox }, use) => {
			await use({
				CONDA_ENVS_PATH: condaSandbox.envsDir,
				CONDA_PKGS_DIRS: condaSandbox.pkgsDir,
				CONDA_REGISTER_ENVS: "false",
			});
		},
		{ scope: "worker" },
	],
	environmentsPage: async ({ condaSandbox }, use) => {
		await use(new EnvironmentsPage(condaSandbox));
	},
});

export const { expect } = test;
