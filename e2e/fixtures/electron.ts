import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test as baseTest, type TestInfo } from "@playwright/test";
import { setPage } from "@anaconda/playwright-utils/page-utils";

import { setCommandPaletteApp } from "../pages/shell/command-palette.js";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import {
	attachProcessLogs,
	MainProcessLog,
	withStartupDiagnostics,
} from "../utils/app-diagnostics.js";
import {
	killProcessTree,
	PACKAGED_APP_POINTER_ARGS,
	packagedAppLaunchEnv,
} from "../utils/app-launcher.js";
import { ConsoleLogCollector } from "../utils/console-log-collector.js";
import { packagedExecutable } from "../utils/paths.js";

// Must match DESKTOP_PRODUCTION_SCHEME in apps/desktop ElectronProtocol.ts.
const DESKTOP_URL_PREFIX = "kilo-desktop://";
const MAIN_WINDOW_TIMEOUT_MS = 30_000;
const WORKER_APP_TIMEOUT_MS = 360_000;
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
 * What a booted window draws: kilo.shell's frame, its first-run onboarding
 * (only for specs that opt into it), or the kernel's own screen (safe mode,
 * or a plugin failure — which a spec then reports, instead of timing out).
 */
const WINDOW_RENDERED =
	'[data-qa-id="shell-main"], [data-qa-id="onboarding-overlay"], [data-qa-id="kernel-recovery"]';

/**
 * Waits for the window to render after a load or a hash reset, so a spec's
 * first locator does not spend its budget on plugin activation.
 */
async function waitForWindowRendered(page: Page): Promise<void> {
	await page.waitForSelector(WINDOW_RENDERED, { timeout: MAIN_WINDOW_TIMEOUT_MS });
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

/** One packaged app per worker, with the profile and output needed to diagnose it. */
type SharedAppRuntime = {
	app: ElectronApplication;
	userDataDir: string;
	log: MainProcessLog;
};

type ElectronWorkerFixtures = {
	appIsolationKey: string;
	appLaunchEnv: Record<string, string>;
	sharedApp: SharedAppRuntime;
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
		args: [`--user-data-dir=${userDataDir}`, ...PACKAGED_APP_POINTER_ARGS],
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

/**
 * Close the packaged app; force-kill its own process tree if graceful quit
 * hangs. Workers run concurrently, so this must never kill by executable
 * name — that would take down another worker's app. Orphans from crashed
 * runs are swept once in global setup/teardown instead.
 */
async function stopApp(app: ElectronApplication): Promise<void> {
	const pid = app.process().pid;
	let exited = false;
	const closed = app.close().then(
		() => {
			exited = true;
		},
		() => undefined,
	);
	const grace = wait(CLOSE_TIMEOUT_MS);
	await Promise.race([closed, grace.promise]);
	grace.cancel();
	if (exited || pid === undefined) return;
	killProcessTree(pid);
	const leftover = wait(CLOSE_FORCE_WAIT_MS);
	await Promise.race([closed, leftover.promise]);
	leftover.cancel();
}

async function removeProfile(userDataDir: string): Promise<void> {
	await Promise.all([
		removeDeferredPaths(),
		rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }),
	]);
}

/**
 * Playwright's `trace` option only records contexts created by its browser
 * fixtures, so traces of Electron specs held test steps and nothing else.
 * Record the Electron window's context explicitly; the result is kept only for
 * failed attempts. Returns undefined when tracing is already active.
 */
async function startWindowTracing(
	app: ElectronApplication,
	testInfo: TestInfo,
): Promise<((failed: boolean) => Promise<void>) | undefined> {
	const tracing = app.context().tracing;
	try {
		await tracing.start({ title: testInfo.title, screenshots: true, snapshots: true });
	} catch {
		return undefined;
	}
	return async (failed) => {
		if (!failed) {
			await tracing.stop();
			return;
		}
		const tracePath = testInfo.outputPath("electron-trace.zip");
		await tracing.stop({ path: tracePath });
		await testInfo.attach("electron-trace", { path: tracePath, contentType: "application/zip" });
	};
}

/**
 * Worker-scoped packaged Electron app. Every test in the worker reuses one launch;
 * `electronApp` rebinds the page singleton and resets the hash between tests,
 * then waits for the window to render (kilo.shell's frame on a normal start).
 * Startup failures carry main-process and Kilo CLI output in their message,
 * because no test-scoped fixture exists yet to attach files.
 */
export const electronFixture = baseTest.extend<ElectronFixtures, ElectronWorkerFixtures>({
	appIsolationKey: ["shared", { scope: "worker", option: true }],
	appLaunchEnv: [{}, { scope: "worker", option: true }],

	sharedApp: [
		async ({ appIsolationKey: _appIsolationKey, appLaunchEnv }, use) => {
			// Depending on the option gives each distinct key its own worker, app,
			// and temporary profile while preserving sharing within that group.
			const { app, userDataDir } = await launchApp(appLaunchEnv);
			const log = new MainProcessLog(app);
			try {
				await waitForWindowRendered(await waitForMainWindow(app));
			} catch (error) {
				const diagnosed = await withStartupDiagnostics(error, log, userDataDir);
				await stopApp(app);
				await removeProfile(userDataDir);
				throw diagnosed;
			}
			await use({ app, userDataDir, log });
			await stopApp(app);
			await removeProfile(userDataDir);
		},
		{ scope: "worker", timeout: WORKER_APP_TIMEOUT_MS },
	],

	electronApp: async ({ sharedApp }, use) => {
		const page = await waitForMainWindow(sharedApp.app);
		setPage(page);
		setCommandPaletteApp(sharedApp.app);
		await page.evaluate(() => {
			localStorage.clear();
			globalThis.location.hash = "#/";
		});
		await waitForWindowRendered(page);
		await use(sharedApp.app);
		// Clear renderer localStorage after each test so plugin preferences
		// written during a test (e.g. git draft mode) do not bleed into the next.
		await page.evaluate(() => localStorage.clear());
	},

	diagnostics: [
		async ({ electronApp, sharedApp }, use, testInfo: TestInfo) => {
			const page = await waitForMainWindow(electronApp);
			const logs = new ConsoleLogCollector(page);
			const logMark = sharedApp.log.mark();
			const stopTracing = await startWindowTracing(electronApp, testInfo);
			logs.start();
			await use();
			// Includes timeouts, which report "timedOut" rather than "failed".
			const failed = testInfo.status !== testInfo.expectedStatus;
			try {
				if (failed) {
					await testInfo.attach("screenshot", {
						body: await page.screenshot(),
						contentType: "image/png",
					});
					await testInfo.attach("page.html", {
						body: await page.content(),
						contentType: "text/html",
					});
					await logs.attach(testInfo);
					await attachProcessLogs(testInfo, sharedApp.log, logMark, sharedApp.userDataDir);
				}
			} finally {
				logs.stop();
				await stopTracing?.(failed);
			}
		},
		{ scope: "test", auto: true },
	],
});
