import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { chromium, expect, test, type Browser } from "@playwright/test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

function packagedExecutable(): string {
	const packageDirectory = path.join(
		repositoryRoot,
		"apps/desktop/out",
		`Anaconda Agentic Desktop-${process.platform}-${process.arch}`,
	);
	switch (process.platform) {
		case "darwin":
			return path.join(
				packageDirectory,
				"Anaconda Agentic Desktop.app/Contents/MacOS/anaconda-agentic-desktop",
			);
		case "win32":
			return path.join(packageDirectory, "anaconda-agentic-desktop.exe");
		default:
			return path.join(packageDirectory, "anaconda-agentic-desktop");
	}
}

async function availablePort(): Promise<number> {
	const server = net.createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Could not reserve a local debugging port.");
	}
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
	return address.port;
}

async function connectToApplication(processHandle: ChildProcess, port: number): Promise<Browser> {
	const endpoint = `http://127.0.0.1:${port}`;
	let lastError: unknown;

	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (processHandle.exitCode !== null) {
			throw new Error(`Packaged application exited with code ${processHandle.exitCode}.`);
		}
		try {
			return await chromium.connectOverCDP(endpoint);
		} catch (error: unknown) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	throw new Error(`Could not connect to the packaged application: ${String(lastError)}`);
}

test("starts the isolated renderer over the Anaconda Desktop protocol", async () => {
	const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-e2e-"));
	const debuggingPort = await availablePort();
	const application = spawn(
		packagedExecutable(),
		[`--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${userDataDirectory}`],
		{ stdio: "ignore" },
	);
	let browser: Browser | undefined;

	try {
		browser = await connectToApplication(application, debuggingPort);
		const context = browser.contexts()[0];
		if (!context) throw new Error("Packaged application did not create a browser context.");
		const page = context.pages()[0] ?? (await context.waitForEvent("page"));
		await expect(page).toHaveTitle(/Todo List · Anaconda Desktop/);
		await expect(page.getByText("Todo List", { exact: true })).toBeVisible();
		await page.getByLabel("New todo").fill("Buy milk");
		await page.getByRole("button", { name: "Add todo" }).click();
		const todo = page.getByRole("checkbox", { name: "Buy milk" });
		await expect(todo).toBeVisible();
		await todo.click();
		await expect(todo).toBeChecked();
		expect(await page.evaluate(() => window.location.href)).toBe(
			"anaconda-agentic-desktop://app/#/",
		);
		expect(
			await page.evaluate(
				() => typeof (window as unknown as { desktopApi: { invoke: unknown } }).desktopApi.invoke,
			),
		).toBe("function");
		expect(await page.evaluate(() => "require" in window)).toBe(false);
	} finally {
		await browser?.close();
		if (application.exitCode === null) {
			application.kill();
			await Promise.race([
				once(application, "exit"),
				new Promise((resolve) => setTimeout(resolve, 5_000)),
			]);
		}
		await rm(userDataDirectory, { recursive: true, force: true });
	}
});
