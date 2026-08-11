import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	themeChromeColors,
	TRANSPARENT_WINDOW_BACKGROUND,
} from "@anaconda-agentic-desktop/contracts";

const { createdWindows, electronApp } = vi.hoisted(() => {
	interface FakeWindow {
		options: {
			backgroundColor?: string;
			backgroundMaterial?: string;
			vibrancy?: string;
			visualEffectState?: string;
			icon?: string;
			titleBarOverlay?: { color: string; symbolColor: string; height: number };
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
		restore: ReturnType<typeof vi.fn>;
		focus: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;
		isDestroyed: ReturnType<typeof vi.fn>;
		isMinimized: ReturnType<typeof vi.fn>;
		isVisible: ReturnType<typeof vi.fn>;
		setBackgroundColor: ReturnType<typeof vi.fn>;
		setTitleBarOverlay: ReturnType<typeof vi.fn>;
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
		readonly restore = vi.fn();
		readonly focus = vi.fn();
		readonly destroy = vi.fn();
		readonly isDestroyed = vi.fn(() => false);
		readonly isMinimized = vi.fn(() => false);
		readonly isVisible = vi.fn(() => false);
		readonly setBackgroundColor = vi.fn();
		readonly setTitleBarOverlay = vi.fn();

		constructor(readonly options: (typeof createdWindows)[number]["options"]) {
			createdWindows.push(this as unknown as (typeof createdWindows)[number]);
		}
	},
}));

vi.mock("./ElectronProtocol.js", () => ({ getDesktopUrl: vi.fn(() => "desktop://app") }));
vi.mock("./ElectronSecurity.js", () => ({ isTrustedRendererUrl: vi.fn(() => true) }));

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

	it("paints the initial Windows background and title bar from the cached scheme", () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const windows = new ElectronWindow(createShell() as never, () => true);

		windows.create({ isDevelopment: false });

		expect(createdWindows[0]?.options.backgroundColor).toBe(themeChromeColors.dark.background);
		expect(createdWindows[0]?.options.backgroundMaterial).toBeUndefined();
		expect(createdWindows[0]?.options.titleBarOverlay).toMatchObject({
			color: themeChromeColors.dark.background,
			symbolColor: themeChromeColors.dark.foreground,
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

		expect(createdWindows[0]?.options.backgroundColor).toBe(themeChromeColors.light.background);
		expect(createdWindows[0]?.options.icon).toBe(
			path.join(electronApp.getAppPath(), "assets/icon.png"),
		);
	});

	it("repaints live window chrome when the renderer syncs a scheme", () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];

		windows.applyColorScheme(true);

		expect(window?.setBackgroundColor).toHaveBeenCalledWith(themeChromeColors.dark.background);
		expect(window?.setTitleBarOverlay).toHaveBeenCalledWith({
			color: themeChromeColors.dark.background,
			symbolColor: themeChromeColors.dark.foreground,
		});
	});

	it("leaves the macOS title bar native while keeping the vibrancy background transparent", () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];

		windows.applyColorScheme(true);

		expect(window?.setBackgroundColor).toHaveBeenCalledWith(TRANSPARENT_WINDOW_BACKGROUND);
		expect(window?.setTitleBarOverlay).not.toHaveBeenCalled();
	});

	it("repaints an opaque Linux window background when the scheme changes", () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];

		windows.applyColorScheme(true);

		expect(window?.setBackgroundColor).toHaveBeenCalledWith(themeChromeColors.dark.background);
		expect(window?.setTitleBarOverlay).toHaveBeenCalledWith({
			color: themeChromeColors.dark.background,
			symbolColor: themeChromeColors.dark.foreground,
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

		window?.isDestroyed.mockReturnValue(true);
		expect(windows.main).toBeUndefined();
		window?.isDestroyed.mockReturnValue(false);
		windows.destroyAll();
		expect(window?.destroy).toHaveBeenCalled();
		expect(windows.main).toBeUndefined();
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
});
