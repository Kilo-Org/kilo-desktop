import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { TRANSPARENT_WINDOW_BACKGROUND, type PaneWindow } from "@kilo-desktop/contracts";

import { getDesktopRouteUrl } from "./ElectronProtocol.js";

const { createdWindows, electronApp } = vi.hoisted(() => {
	interface FakeWindow {
		options: {
			backgroundColor?: string;
			backgroundMaterial?: string;
			name?: string;
			vibrancy?: string;
			visualEffectState?: string;
			icon?: string;
			titleBarOverlay?: { color: string; symbolColor: string; height: number };
			webPreferences?: { additionalArguments?: string[]; webviewTag?: boolean };
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

vi.mock("electron", () => ({
	app: electronApp,
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

		constructor(readonly options: (typeof createdWindows)[number]["options"]) {
			createdWindows.push(this as unknown as (typeof createdWindows)[number]);
		}
	},
}));

vi.mock("./ElectronProtocol.js", () => ({
	getDesktopRouteUrl: vi.fn(() => "desktop://app/#/plugins/chat"),
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
			symbolColor: "#f0f0f0",
			height: 47,
		});
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

	it("repaints both main and pane windows with the selected palette", () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		let dark = false;
		let themeId = "kilo";
		const windows = new ElectronWindow(
			createShell() as never,
			() => dark,
			() => themeId,
		);
		windows.create({ isDevelopment: false });
		windows.openPaneWindow(
			{ pluginId: "kilo-ui", sessionId: "s1", paneId: "p1", title: "File", path: "/plugins/chat" },
			false,
		);

		dark = true;
		themeId = "dracula";
		windows.applyColorScheme();

		for (const window of createdWindows) {
			expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#282a36");
			expect(window.setTitleBarOverlay).toHaveBeenLastCalledWith({
				color: "#282a36",
				symbolColor: "#f8f8f2",
			});
		}
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
			symbolColor: "#f0f0f0",
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

	it("enables webviews only in the main application window", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		windows.openPaneWindow(
			{ pluginId: "kilo-ui", sessionId: "s1", paneId: "p1", title: "File", path: "/plugins/chat" },
			false,
		);

		expect(createdWindows[0]?.options.webPreferences?.webviewTag).toBe(true);
		expect(createdWindows[1]?.options.webPreferences?.webviewTag).toBe(false);
	});

	it("gives the main and pane windows the native context menu", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: true });
		windows.openPaneWindow(
			{ pluginId: "kilo-ui", sessionId: "s1", paneId: "p1", title: "File", path: "/plugins/chat" },
			false,
		);

		expect(attachContextMenu).toHaveBeenCalledWith(createdWindows[0]?.webContents, {
			isDevelopment: true,
		});
		expect(attachContextMenu).toHaveBeenCalledWith(createdWindows[1]?.webContents, {
			isDevelopment: false,
		});
	});

	it("reveals, broadcasts to, and destroys the live window", () => {
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

		windows.broadcast("auth:changed", { status: "anonymous" });
		expect(window?.webContents.send).toHaveBeenCalledWith("auth:changed", {
			status: "anonymous",
		});

		windows.navigateMain({
			path: "/settings/local-model-server",
			search: { catalogModel: "catalog-model" },
		});
		expect(window?.webContents.send).toHaveBeenCalledWith("shell:navigate", {
			path: "/settings/local-model-server",
			search: { catalogModel: "catalog-model" },
		});

		window?.isDestroyed.mockReturnValue(true);
		expect(windows.main).toBeUndefined();
		window?.isDestroyed.mockReturnValue(false);
		windows.destroyAll();
		expect(window?.destroy).toHaveBeenCalled();
		expect(windows.main).toBeUndefined();
	});

	it("loads a deep-link route into the main window", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({
			isDevelopment: false,
			initialRoute: {
				path: "/settings/local-model-server",
				search: { catalogModel: "catalog-model" },
			},
		});

		expect(getDesktopRouteUrl).toHaveBeenCalledWith(false, "/settings/local-model-server", {
			catalogModel: "catalog-model",
		});
		expect(createdWindows[0]?.loadURL).toHaveBeenCalledWith("desktop://app/#/plugins/chat");

		windows.loadMainRoute({
			path: "/settings/local-model-server",
			search: { catalogModel: "other-model" },
		});
		expect(getDesktopRouteUrl).toHaveBeenCalledWith(false, "/settings/local-model-server", {
			catalogModel: "other-model",
		});
	});

	it("opens, focuses, hides, and docks a session-owned pane window", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		const pane: PaneWindow = {
			pluginId: "kilo-ui",
			sessionId: "session-1",
			paneId: "file:readme.md",
			title: "readme.md",
			path: "/plugins/chat",
			workspaceId: "workspace-1",
		};

		expect(createdWindows[0]?.options.webPreferences?.additionalArguments).toEqual(
			expect.arrayContaining(["--kilo-webmcp-port=9345", "--kilo-webmcp-relay-id=kilo-desktop"]),
		);
		expect(windows.openPaneWindow(pane, false)).toEqual({ opened: true });
		expect(getDesktopRouteUrl).toHaveBeenCalledWith(false, "/plugins/chat", {
			paneWindow: "true",
			panePluginId: "kilo-ui",
			paneSessionId: "session-1",
			paneId: "file:readme.md",
			paneWorkspaceId: "workspace-1",
		});
		const detached = createdWindows[1];
		expect(detached?.options.name).toBe("pane:kilo-ui:session-1:file:readme.md");
		expect(detached?.options.webPreferences?.additionalArguments).toContain(
			"--kilo-window-role=pane",
		);
		expect(detached?.options.windowStatePersistence).toBeUndefined();
		expect(windows.listPaneWindows("kilo-ui")).toEqual([pane]);

		createdWindows[0]?.isVisible.mockReturnValue(true);
		const ready = detached?.once.mock.calls.find((call) => call[0] === "ready-to-show")?.[1];
		ready?.();
		expect(detached?.show).toHaveBeenCalled();
		expect(detached?.focus).toHaveBeenCalled();

		detached?.isVisible.mockReturnValue(true);
		windows.syncPaneWindows("kilo-ui", "session-2");
		expect(detached?.hide).toHaveBeenCalled();
		createdWindows[0]?.isVisible.mockReturnValue(true);
		detached?.isVisible.mockReturnValue(false);
		windows.syncPaneWindows("kilo-ui", "session-1");
		expect(detached?.showInactive).toHaveBeenCalled();

		detached?.isVisible.mockReturnValue(true);
		const hideMain = createdWindows[0]?.on.mock.calls.find((call) => call[0] === "hide")?.[1];
		hideMain?.();
		expect(detached?.hide).toHaveBeenCalledTimes(2);

		detached?.isVisible.mockReturnValue(false);
		const showMain = createdWindows[0]?.on.mock.calls.find((call) => call[0] === "show")?.[1];
		showMain?.();
		expect(detached?.showInactive).toHaveBeenCalledTimes(2);

		expect(windows.focusPaneWindow(pane)).toEqual({ focused: true });
		expect(detached?.focus).toHaveBeenCalledTimes(2);
		expect(windows.dockPaneWindow(pane)).toEqual({ docked: true });
		expect(detached?.close).toHaveBeenCalled();

		const closed = detached?.on.mock.calls.find((call) => call[0] === "closed")?.[1];
		closed?.();
		expect(windows.listPaneWindows("kilo-ui")).toEqual([]);
		expect(createdWindows[0]?.webContents.send).toHaveBeenCalledWith("shell:pane-window-changed", {
			type: "docked",
			pluginId: "kilo-ui",
			sessionId: "session-1",
			paneId: "file:readme.md",
		});
	});

	it("keeps a pane window hidden when the main window hides before the pane is ready", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		windows.openPaneWindow(
			{
				pluginId: "kilo-ui",
				sessionId: "session-1",
				paneId: "file:readme.md",
				title: "readme.md",
				path: "/plugins/chat",
			},
			false,
		);

		const detached = createdWindows[1];
		const ready = detached?.once.mock.calls.find((call) => call[0] === "ready-to-show")?.[1];
		ready?.();

		expect(detached?.show).not.toHaveBeenCalled();
		expect(detached?.focus).not.toHaveBeenCalled();
	});

	it("broadcasts renderer events to every window except their origin", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		windows.create({ isDevelopment: false });
		const [origin, other] = createdWindows;
		const event = { featureId: "producer", name: "changed", payload: { id: "1" } };

		windows.broadcast("feature:event", event, origin?.webContents.id);

		expect(origin?.webContents.send).not.toHaveBeenCalled();
		expect(other?.webContents.send).toHaveBeenCalledWith("feature:event", event);
	});

	it("scopes title and focus capabilities to the requesting renderer", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		windows.create({ isDevelopment: false });
		const [first, second] = createdWindows;

		expect(windows.getTitle(second!.webContents.id)).toBe("Kilo");
		windows.setTitle(second!.webContents.id, "Analysis");
		expect(first?.setTitle).not.toHaveBeenCalled();
		expect(second?.setTitle).toHaveBeenCalledWith("Analysis");
		expect(windows.isFocused(second!.webContents.id)).toBe(true);

		const listener = vi.fn();
		const unlisten = windows.onFocusChange(second!.webContents.id, listener);
		const focus = second?.on.mock.calls.find((call) => call[0] === "focus")?.[1];
		focus?.();
		expect(listener).toHaveBeenCalledWith(true);
		unlisten();
		expect(second?.off).toHaveBeenCalledWith("focus", focus);
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
});
