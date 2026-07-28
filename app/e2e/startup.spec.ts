import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);

test("starts the isolated renderer over the Anaconda Desktop protocol", async () => {
	const electronEntry = require.resolve("electron", {
		paths: [path.join(repositoryRoot, "app")],
	});
	const electronExecutable = require(electronEntry) as string;
	const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-e2e-"));
	const application = await electron.launch({
		executablePath: electronExecutable,
		args: [
			`--user-data-dir=${userDataDirectory}`,
			path.join(repositoryRoot, "app/.vite/build/main.js"),
		],
	});

	try {
		const page = await application.firstWindow();
		await expect(page).toHaveTitle(/Todo List · Anaconda Desktop/);
		await expect(page.getByText("Todo List", { exact: true })).toBeVisible();
		await page.getByLabel("New todo").fill("Buy milk");
		await page.getByRole("button", { name: "Add todo" }).click();
		const todo = page.getByRole("checkbox", { name: "Buy milk" });
		await expect(todo).toBeVisible();
		await todo.check();
		await expect(todo).toBeChecked();
		expect(await page.evaluate(() => window.location.href)).toBe("anaconda-desktop-dev://app/");
		expect(
			await page.evaluate(
				() => typeof (window as unknown as { desktopApi: { invoke: unknown } }).desktopApi.invoke,
			),
		).toBe("function");
		expect(await page.evaluate(() => "require" in window)).toBe(false);
	} finally {
		await application.close();
		await rm(userDataDirectory, { recursive: true, force: true });
	}
});
