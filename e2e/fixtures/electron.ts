import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test as baseTest, type TestInfo } from "@playwright/test";
import { setPage } from "@anaconda/playwright-utils/page-utils";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import {
	killProcessTree,
	killStrayProcesses,
	packagedAppLaunchEnv,
} from "../utils/app-launcher.js";
import { ConsoleLogCollector } from "../utils/console-log-collector.js";
import { packagedExecutable } from "../utils/paths.js";

// Must match DESKTOP_PRODUCTION_SCHEME in apps/desktop ElectronProtocol.ts.
const DESKTOP_URL_PREFIX = "anaconda-agentic-desktop://";
const MAIN_WINDOW_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 10_000;
const CLOSE_FORCE_WAIT_MS = 5_000;
const deferredRemovalPaths = new Set<string>();

/**
 * Test workspaces can remain open in the packaged app until worker teardown,
 * especially on Windows where active directory handles make `rm` fail with
 * EBUSY. Workspace fixtures register their paths here so the worker owns the
 * invariant that Electron stops before those paths are removed.
 */
export function removePathAfterAppStops(targetPath: string): void {
	deferredRemovalPaths.add(targetPath);
}

async function removeDeferredPaths(): Promise<void> {
	const paths = [...deferredRemovalPaths];
	deferredRemovalPaths.clear();
	await Promise.all(
		paths.map((targetPath) =>
			rm(targetPath, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }),
		),
	);
}

/**
 * The app's first window is the splash screen — a `data:` URL with no preload,
 * destroyed once boot finishes. `firstWindow()` / `waitForEvent("window")` can
 * race it and return a page without `desktopApi`, or miss the main window when
 * the same BrowserWindow navigates from `data:` / `about:blank` onto the
 * desktop protocol (no second "window" event). Poll until a protocol URL exists.
 */
export async function waitForMainWindow(
	app: ElectronApplication,
	timeoutMs = MAIN_WINDOW_TIMEOUT_MS,
): Promise<Page> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const match = app.windows().find((page) => page.url().startsWith(DESKTOP_URL_PREFIX));
		if (match) return match;
		if (Date.now() > deadline) {
			throw new Error("Timed out waiting for the main app window");
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

type ElectronFixtures = {
	electronApp: ElectronApplication;
	diagnostics: void;
};

type ElectronWorkerFixtures = {
	sharedApp: ElectronApplication;
};

async function launchApp(): Promise<{ app: ElectronApplication; userDataDir: string }> {
	const userDataDir = await mkdtemp(path.join(os.tmpdir(), "aad-e2e-"));
	const app = await electron.launch({
		executablePath: packagedExecutable(),
		args: [`--user-data-dir=${userDataDir}`],
		env: packagedAppLaunchEnv(),
	});
	return { app, userDataDir };
}

function wait(ms: number): { promise: Promise<void>; cancel: () => void } {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const promise = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, ms);
	});
	return {
		promise,
		cancel: () => {
			if (timer !== undefined) clearTimeout(timer);
		},
	};
}

/** Close the packaged app; force-kill the process tree if graceful quit hangs. */
async function stopApp(app: ElectronApplication): Promise<void> {
	const pid = app.process().pid;
	const closed = app.close().then(
		() => undefined,
		() => undefined,
	);
	const grace = wait(CLOSE_TIMEOUT_MS);
	const timedOut = await Promise.race([closed.then(() => false), grace.promise.then(() => true)]);
	grace.cancel();
	if (timedOut && pid !== undefined) killProcessTree(pid);
	const leftover = wait(CLOSE_FORCE_WAIT_MS);
	await Promise.race([closed, leftover.promise]);
	leftover.cancel();
	killStrayProcesses();
}

/**
 * Worker-scoped packaged Electron app. Every test in the worker reuses one launch;
 * `electronApp` rebinds the page singleton and resets the hash between tests.
 */
export const electronFixture = baseTest.extend<ElectronFixtures, ElectronWorkerFixtures>({
	sharedApp: [
		// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
		async ({}, use) => {
			await killStrayProcesses();
			const { app, userDataDir } = await launchApp();
			await use(app);
			await stopApp(app);
			await Promise.all([
				removeDeferredPaths(),
				rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }),
			]);
		},
		{ scope: "worker" },
	],

	electronApp: async ({ sharedApp }, use) => {
		const page = await waitForMainWindow(sharedApp);
		setPage(page);
		await page.evaluate(() => {
			globalThis.location.hash = "#/";
		});
		await use(sharedApp);
	},

	diagnostics: [
		async ({ electronApp }, use, testInfo: TestInfo) => {
			const page = await waitForMainWindow(electronApp);
			const logs = new ConsoleLogCollector(page);
			logs.start();
			await use();
			if (testInfo.status === "failed") {
				await testInfo.attach("screenshot", {
					body: await page.screenshot(),
					contentType: "image/png",
				});
				await testInfo.attach("page.html", {
					body: await page.content(),
					contentType: "text/html",
				});
				await logs.attach(testInfo);
			}
			logs.stop();
		},
		{ scope: "test", auto: true },
	],
});
