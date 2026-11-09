import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getThemeChrome } from "@kilo-desktop/ui/themes/app-themes";
import { TRANSPARENT_WINDOW_BACKGROUND } from "@kilo-desktop/ui/themes/theme-tokens";

const { createdWindows, electronApp } = vi.hoisted(() => {
	interface FakeWindow {
		options: {
			backgroundColor?: string;
			backgroundMaterial?: string;
			fullscreen?: boolean;
			name?: string;
			width?: number;
			useContentSize?: boolean;
			vibrancy?: string;
			visualEffectState?: string;
			icon?: string;
			titleBarOverlay?: { color: string; symbolColor: string; height: number };
			webPreferences?: {
				additionalArguments?: string[];
				preload?: string;
				webviewTag?: boolean;
				devTools?: boolean;
			};
			windowStatePersistence?: boolean;
		};
		webContents: {
			id: number;
			setWindowOpenHandler: ReturnType<typeof vi.fn>;
			on: ReturnType<typeof vi.fn>;
			send: ReturnType<typeof vi.fn>;
		};
		once: ReturnType<typeof vi.fn>;
		on: ReturnType<typeof vi.fn>;
		loadURL: ReturnType<typeof vi.fn>;
		show: ReturnType<typeof vi.fn>;
		showInactive: ReturnType<typeof vi.fn>;
		hide: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
		restore: ReturnType<typeof vi.fn>;
		focus: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;
		isDestroyed: ReturnType<typeof vi.fn>;
		isMinimized: ReturnType<typeof vi.fn>;
		isVisible: ReturnType<typeof vi.fn>;
		setBackgroundColor: ReturnType<typeof vi.fn>;
		setTitleBarOverlay: ReturnType<typeof vi.fn>;
		getTitle: ReturnType<typeof vi.fn>;
		setTitle: ReturnType<typeof vi.fn>;
		isFocused: ReturnType<typeof vi.fn>;
		off: ReturnType<typeof vi.fn>;
	}

	return {
		createdWindows: [] as FakeWindow[],
		electronApp: {
			focus: vi.fn(),
			getName: vi.fn(() => "Test App"),
			getAppPath: vi.fn(() => "/fake/app"),
			isPackaged: false,
		},
	};
});

const workArea = vi.hoisted(() => ({ x: 0, y: 0, width: 1440, height: 900 }));

vi.mock("electron", () => ({
	app: electronApp,
	screen: {
		getDisplayMatching: () => ({ workArea }),
		getPrimaryDisplay: () => ({ workArea }),
	},
	BrowserWindow: class {
		static getAllWindows() {
			return createdWindows;
		}

		readonly webContents = {
			id: createdWindows.length + 1,
			setWindowOpenHandler: vi.fn(),
			on: vi.fn(),
			send: vi.fn(),
		};
		readonly once = vi.fn();
		readonly on = vi.fn();
		readonly loadURL = vi.fn();
		readonly show = vi.fn();
		readonly showInactive = vi.fn();
		readonly hide = vi.fn();
		readonly close = vi.fn();
		readonly restore = vi.fn();
		readonly focus = vi.fn();
		readonly destroy = vi.fn();
		readonly isDestroyed = vi.fn(() => false);
		readonly isMinimized = vi.fn(() => false);
		readonly isVisible = vi.fn(() => false);
		readonly setBackgroundColor = vi.fn();
		readonly setTitleBarOverlay = vi.fn();
		readonly getTitle = vi.fn(() => "Kilo");
		readonly setTitle = vi.fn();
		readonly isFocused = vi.fn(() => true);
		readonly off = vi.fn();
		readonly getBounds = vi.fn(() => ({ x: 0, y: 0, width: 1280, height: 860 }));

		constructor(readonly options: (typeof createdWindows)[number]["options"]) {
			createdWindows.push(this as unknown as (typeof createdWindows)[number]);
		}
	},
}));

vi.mock("./ElectronProtocol.js", () => ({
	getDesktopUrl: vi.fn(() => "desktop://app"),
}));
vi.mock("./ElectronSecurity.js", () => ({ isTrustedRendererUrl: vi.fn(() => true) }));
vi.mock("./ElectronContextMenu.js", () => ({ attachContextMenu: vi.fn() }));

import { attachContextMenu } from "./ElectronContextMenu.js";
import { ElectronWindow } from "./ElectronWindow.js";
import { isTrustedRendererUrl } from "./ElectronSecurity.js";

function createShell() {
	return { openExternal: vi.fn(async () => undefined) };
}

function openSecondary(windows: ElectronWindow, width?: number) {
	return windows.openSecondary({
		isDevelopment: false,
		title: "Board",
		additionalArguments: ["--kilo-window=board"],
		...(width === undefined ? {} : { width }),
	});
}

describe("ElectronWindow theme chrome", () => {
	const originalPlatform = process.platform;

	afterEach(() => {
		createdWindows.length = 0;
		vi.clearAllMocks();
		vi.mocked(isTrustedRendererUrl).mockReturnValue(true);
		Object.defineProperty(process, "platform", { value: originalPlatform });
	});

	it("paints the initial Windows background and title bar with Kilo when no palette is saved", () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const windows = new ElectronWindow(createShell() as never, () => true);

		windows.create({ isDevelopment: false });

		expect(createdWindows[0]?.options.backgroundColor).toBe("#111111");
		expect(createdWindows[0]?.options.backgroundMaterial).toBeUndefined();
		expect(createdWindows[0]?.options.name).toBe("Test App");
		expect(createdWindows[0]?.options.windowStatePersistence).toBe(true);
		expect(createdWindows[0]?.options.titleBarOverlay).toMatchObject({
			color: "#111111",
			symbolColor: "#d4d4d4",
			height: 47,
		});
	});

	it("keeps window names unique: only the main window is named", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);

		windows.create({ isDevelopment: false });
		openSecondary(windows);
		openSecondary(windows);

		expect(createdWindows.map((window) => window.options.name)).toEqual([
			"Test App",
			undefined,
			undefined,
		]);
		expect(createdWindows[1]?.options.windowStatePersistence).toBeUndefined();
	});

	it("enables macOS vibrancy with a transparent window background", () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		const windows = new ElectronWindow(createShell() as never, () => false);

		windows.create({ isDevelopment: false });

		expect(createdWindows[0]?.options.backgroundColor).toBe(TRANSPARENT_WINDOW_BACKGROUND);
		expect(createdWindows[0]?.options.vibrancy).toBe("under-window");
		expect(createdWindows[0]?.options.visualEffectState).toBe("active");
		expect(createdWindows[0]?.options.titleBarOverlay).toBeUndefined();
	});

	it("uses a platform-native path for the unpackaged Linux icon", () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		const windows = new ElectronWindow(createShell() as never, () => false);

		windows.create({ isDevelopment: false });

		expect(createdWindows[0]?.options.backgroundColor).toBe("#ffffff");
		expect(createdWindows[0]?.options.icon).toBe(
			path.join(electronApp.getAppPath(), "assets/icon.png"),
		);
	});

	it("loads Forge's CommonJS preload bundle by default", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);

		windows.create({ isDevelopment: false });

		// Forge 8 emits the sandboxed preload as `preload.cjs` (`.js` under
		// `"type": "module"` would be parsed as ESM and rejected by Electron).
		expect(path.basename(createdWindows[0]?.options.webPreferences?.preload ?? "")).toBe(
			"preload.cjs",
		);
	});

	it("repaints both main and secondary windows with the supplied palette", () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		let dark = false;
		const palette: { chrome?: ReturnType<typeof getThemeChrome> } = {};
		const windows = new ElectronWindow(
			createShell() as never,
			() => dark,
			() => palette.chrome,
		);
		windows.create({ isDevelopment: false });
		openSecondary(windows);

		dark = true;
		palette.chrome = getThemeChrome("dracula");
		windows.applyColorScheme();

		for (const window of createdWindows) {
			expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#282a36");
			expect(window.setTitleBarOverlay).toHaveBeenLastCalledWith({
				color: "#282a36",
				symbolColor: "#f8f8f2",
			});
		}
	});

	it("keeps repainting when a fullscreen window rejects the title bar overlay", () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const windows = new ElectronWindow(createShell() as never, () => true);
		windows.create({ isDevelopment: false });
		openSecondary(windows);
		const [fullscreen, other] = createdWindows;
		// Electron throws this exact error from setTitleBarOverlay while the
		// window is fullscreen on Windows, where the overlay is inactive.
		fullscreen?.setTitleBarOverlay.mockImplementation(() => {
			throw new Error("Titlebar overlay is not enabled");
		});

		expect(() => windows.applyColorScheme()).not.toThrow();

		expect(fullscreen?.setBackgroundColor).toHaveBeenCalled();
		expect(other?.setBackgroundColor).toHaveBeenCalled();
		expect(other?.setTitleBarOverlay).toHaveBeenCalled();
	});

	it("leaves the macOS title bar native while keeping the vibrancy background transparent", () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		const windows = new ElectronWindow(createShell() as never, () => true);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];

		windows.applyColorScheme();

		expect(window?.setBackgroundColor).toHaveBeenCalledWith(TRANSPARENT_WINDOW_BACKGROUND);
		expect(window?.setTitleBarOverlay).not.toHaveBeenCalled();
	});

	it("repaints an opaque Linux window background when the scheme changes", () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		let dark = false;
		const windows = new ElectronWindow(createShell() as never, () => dark);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];

		dark = true;
		windows.applyColorScheme();

		expect(window?.setBackgroundColor).toHaveBeenCalledWith("#111111");
		expect(window?.setTitleBarOverlay).toHaveBeenCalledWith({
			color: "#111111",
			symbolColor: "#d4d4d4",
		});
	});

	it("manages window lifecycle and routes untrusted URLs through the shell", () => {
		const shell = createShell();
		const windows = new ElectronWindow(shell as never, () => false);
		windows.create({ isDevelopment: false, preloadPath: "/preload.js", options: { width: 1200 } });
		const window = createdWindows[0];

		const readyToShow = window?.once.mock.calls.find((call) => call[0] === "ready-to-show")?.[1];
		readyToShow?.();
		expect(window?.show).toHaveBeenCalled();
		expect(windows.main).toBe(window);
		expect(window?.options.webPreferences).toMatchObject({ webviewTag: true });

		const willAttach = window?.webContents.on.mock.calls.find(
			(call) => call[0] === "will-attach-webview",
		)?.[1];
		const denied = { preventDefault: vi.fn() };
		willAttach?.(denied, {}, { partition: "persist:untrusted" });
		expect(denied.preventDefault).toHaveBeenCalledOnce();
		const accepted = { preventDefault: vi.fn() };
		const guestPreferences: Record<string, unknown> = { preload: "/evil.js" };
		willAttach?.(accepted, guestPreferences, { partition: "persist:kilo-desktop-browser" });
		expect(accepted.preventDefault).not.toHaveBeenCalled();
		expect(guestPreferences).toMatchObject({
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			webSecurity: true,
			allowRunningInsecureContent: false,
		});
		expect(guestPreferences).not.toHaveProperty("preload");

		const openHandler = window?.webContents.setWindowOpenHandler.mock.calls[0]?.[0];
		expect(openHandler?.({ url: "https://example.com" })).toEqual({ action: "deny" });
		expect(shell.openExternal).toHaveBeenCalledWith("https://example.com");

		const willNavigate = window?.webContents.on.mock.calls.find(
			(call) => call[0] === "will-navigate",
		)?.[1];
		const trustedEvent = { preventDefault: vi.fn() };
		willNavigate?.(trustedEvent, "desktop://app");
		expect(trustedEvent.preventDefault).not.toHaveBeenCalled();

		vi.mocked(isTrustedRendererUrl).mockReturnValue(false);
		const untrustedEvent = { preventDefault: vi.fn() };
		willNavigate?.(untrustedEvent, "https://untrusted.example");
		expect(untrustedEvent.preventDefault).toHaveBeenCalled();
		expect(shell.openExternal).toHaveBeenCalledWith("https://untrusted.example");

		const closed = window?.on.mock.calls.find((call) => call[0] === "closed")?.[1];
		closed?.();
		expect(windows.main).toBeUndefined();
	});

	it("enables webviews in main and pop-out windows, with the guest guard on both", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		openSecondary(windows);

		for (const window of createdWindows) {
			expect(window.options.webPreferences?.webviewTag).toBe(true);
			const willAttach = window.webContents.on.mock.calls.find(
				(call) => call[0] === "will-attach-webview",
			)?.[1];
			const denied = { preventDefault: vi.fn() };
			willAttach?.(denied, {}, { partition: "persist:untrusted" });
			expect(denied.preventDefault).toHaveBeenCalledOnce();
		}
	});

	it("gives the main and secondary windows the native context menu", () => {
		const shell = createShell();
		const windows = new ElectronWindow(shell as never, () => false);
		windows.create({ isDevelopment: true });
		openSecondary(windows);

		expect(attachContextMenu).toHaveBeenCalledWith(createdWindows[0]?.webContents, {
			isDevelopment: true,
			shell,
		});
		expect(attachContextMenu).toHaveBeenCalledWith(createdWindows[1]?.webContents, {
			isDevelopment: false,
			shell,
		});
	});

	it("reveals and destroys the live window", () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		const windows = new ElectronWindow(createShell() as never, () => false);
		expect(windows.main).toBeUndefined();

		windows.create({ isDevelopment: false });
		const window = createdWindows[0];
		window?.isMinimized.mockReturnValue(true);

		windows.reveal();
		expect(window?.restore).toHaveBeenCalled();
		expect(window?.show).toHaveBeenCalled();
		expect(window?.focus).toHaveBeenCalled();
		expect(electronApp.focus).toHaveBeenCalledWith({ steal: true });

		window?.isDestroyed.mockReturnValue(true);
		expect(windows.main).toBeUndefined();
		window?.isDestroyed.mockReturnValue(false);
		windows.destroyAll();
		expect(window?.destroy).toHaveBeenCalled();
		expect(windows.main).toBeUndefined();
	});

	it("opens a secondary window at the content width it asks for, kept within the screen", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });

		openSecondary(windows, 1204);
		expect(createdWindows[1]?.options).toMatchObject({ width: 1204, useContentSize: true });

		openSecondary(windows, 5000);
		expect(createdWindows[2]?.options).toMatchObject({ width: 1440 });

		openSecondary(windows);
		expect(createdWindows[3]?.options).toMatchObject({ width: 960 });
		expect(createdWindows[3]?.options).not.toHaveProperty("useContentSize");
		expect(createdWindows[3]?.options.webPreferences?.additionalArguments).toEqual([
			"--kilo-window=board",
		]);
	});

	it("destroys secondary windows with the main window, past any close veto", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		const secondary = openSecondary(windows) as unknown as (typeof createdWindows)[number];

		const closed = createdWindows[0]?.once.mock.calls.find((call) => call[0] === "closed")?.[1];
		closed?.();

		expect(secondary.destroy).toHaveBeenCalled();
		expect(secondary.close).not.toHaveBeenCalled();
	});

	it("stops following the main window once a secondary window closes", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		const main = createdWindows[0]!;
		const secondary = openSecondary(windows) as unknown as (typeof createdWindows)[number];
		const followMain = main.once.mock.calls.find((call) => call[0] === "closed")?.[1];

		const secondaryClosed = secondary.once.mock.calls.find((call) => call[0] === "closed")?.[1];
		secondaryClosed?.();

		expect(main.off).toHaveBeenCalledWith("closed", followMain);
	});

	it("does not auto-show a deferred window and resolves whenReady once it paints", async () => {
		vi.useFakeTimers();
		try {
			const windows = new ElectronWindow(createShell() as never, () => false);
			windows.create({ isDevelopment: false, deferShow: true });
			const window = createdWindows[0];

			// deferShow=true means no ready-to-show auto-show handler was registered.
			const autoShow = window?.once.mock.calls.find((call) => call[0] === "ready-to-show");
			expect(autoShow).toBeUndefined();

			const ready = windows.whenReady();
			const readyToShow = window?.once.mock.calls.find((call) => call[0] === "ready-to-show")?.[1];
			readyToShow?.();

			await expect(ready).resolves.toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it("whenReady resolves immediately when there is no live window", async () => {
		const windows = new ElectronWindow(createShell() as never, () => false);

		await expect(windows.whenReady()).resolves.toBeUndefined();
	});

	it("reveal is a no-op when there is no live window", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);

		expect(() => windows.reveal()).not.toThrow();
	});

	it("uses the packaged resources path for the Linux icon when packaged", () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		electronApp.isPackaged = true;
		const originalResourcesPath = process.resourcesPath;
		Object.defineProperty(process, "resourcesPath", {
			value: "/fake/resources",
			configurable: true,
		});
		try {
			const windows = new ElectronWindow(createShell() as never, () => false);
			windows.create({ isDevelopment: false });

			expect(createdWindows[0]?.options.icon).toBe(path.join("/fake/resources", "icon.png"));
		} finally {
			electronApp.isPackaged = false;
			Object.defineProperty(process, "resourcesPath", {
				value: originalResourcesPath,
				configurable: true,
			});
		}
	});

	it("disables renderer DevTools in packaged builds", () => {
		// darwin skips linuxWindowIcon(), which would read an unset process.resourcesPath.
		Object.defineProperty(process, "platform", { value: "darwin" });
		electronApp.isPackaged = true;
		try {
			const windows = new ElectronWindow(createShell() as never, () => false);
			windows.create({ isDevelopment: false });
			expect(createdWindows[0]?.options.webPreferences?.devTools).toBe(false);
		} finally {
			electronApp.isPackaged = false;
		}
	});

	it("leaves renderer DevTools enabled in development (unpackaged) builds", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: true });
		expect(createdWindows[0]?.options.webPreferences?.devTools).toBe(true);
	});
});
