import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
const DESKTOP_URL_PREFIX = "kilo-desktop://";
const MAIN_WINDOW_TIMEOUT_MS = 30_000;
const KILO_SERVER_READY_TIMEOUT_MS = 120_000;
const WORKER_APP_TIMEOUT_MS = 240_000;
const CLOSE_TIMEOUT_MS = 10_000;
const CLOSE_FORCE_WAIT_MS = 5_000;
const PLAYWRIGHT_DEFAULT_TIMEOUT_MS = 30_000;
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

async function waitForKiloServer(page: Page): Promise<void> {
	page.setDefaultTimeout(KILO_SERVER_READY_TIMEOUT_MS);
	try {
		await page.waitForFunction(() => "desktopApi" in globalThis, undefined, {
			timeout: MAIN_WINDOW_TIMEOUT_MS,
		});
		await page.evaluate(async () => {
			type InvokeResult =
				| { ok: true; value: unknown }
				| { ok: false; error: { code: string; message: string } };
			type DesktopGlobal = typeof globalThis & {
				desktopApi: {
					invoke(
						channel: "feature:invoke",
						input: { featureId: string; channel: string; args?: unknown },
					): Promise<InvokeResult>;
				};
			};
			const response = await (globalThis as DesktopGlobal).desktopApi.invoke("feature:invoke", {
				featureId: "kilo-server",
				channel: "server.getConnection",
			});
			if (!response.ok) throw new Error(`[${response.error.code}] ${response.error.message}`);
		});
	} finally {
		page.setDefaultTimeout(PLAYWRIGHT_DEFAULT_TIMEOUT_MS);
	}
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
	appIsolationKey: string;
	appLaunchEnv: Record<string, string>;
	sharedApp: ElectronApplication;
};

async function launchApp(
	envOverrides: Readonly<Record<string, string>>,
): Promise<{ app: ElectronApplication; userDataDir: string }> {
	const userDataDir = await mkdtemp(path.join(os.tmpdir(), "kilo-e2e-"));
	// The launch env points GIT_CONFIG_GLOBAL/SYSTEM here; pre-create both as
	// empty files so the long-lived GUI process never falls back to real
	// global/system gitconfig paths on any git version.
	await writeFile(path.join(userDataDir, ".gitconfig"), "");
	await writeFile(path.join(userDataDir, ".gitconfig-system"), "");
	const app = await electron.launch({
		executablePath: packagedExecutable(),
		args: [`--user-data-dir=${userDataDir}`],
		env: packagedAppLaunchEnv(userDataDir, { ...process.env, ...envOverrides }),
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
 * Sidecar spawn (`server.getConnection`) runs here so the first @smoke spec does
 * not spend the 15s expect budget waiting for kilo-server to come up.
 */
export const electronFixture = baseTest.extend<ElectronFixtures, ElectronWorkerFixtures>({
	appIsolationKey: ["shared", { scope: "worker", option: true }],
	appLaunchEnv: [{}, { scope: "worker", option: true }],

	sharedApp: [
		async ({ appIsolationKey, appLaunchEnv }, use) => {
			// Depending on the option gives each distinct key its own worker, app,
			// and temporary profile while preserving sharing within that group.
			void appIsolationKey;
			await killStrayProcesses();
			const { app, userDataDir } = await launchApp(appLaunchEnv);
			const page = await waitForMainWindow(app);
			await waitForKiloServer(page);
			await use(app);
			await stopApp(app);
			await Promise.all([
				removeDeferredPaths(),
				rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }),
			]);
		},
		{ scope: "worker", timeout: WORKER_APP_TIMEOUT_MS },
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
