import { afterEach, describe, expect, it, vi } from "vitest";

import { themeChromeColors } from "@anaconda-agentic-desktop/contracts";

const { createdWindows, electronApp } = vi.hoisted(() => {
	interface FakeWindow {
		options: {
			backgroundColor?: string;
			titleBarOverlay?: { color: string; symbolColor: string; height: number };
		};
		webContents: {
			setWindowOpenHandler: ReturnType<typeof vi.fn>;
			on: ReturnType<typeof vi.fn>;
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
		electronApp: { focus: vi.fn() },
	};
});

vi.mock("electron", () => ({
	app: electronApp,
	BrowserWindow: class {
		static getAllWindows() {
			return createdWindows;
		}
		readonly options: (typeof createdWindows)[number]["options"];
		readonly webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() };
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
		constructor(options: (typeof createdWindows)[number]["options"]) {
			this.options = options;
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

describe("ElectronWindow", () => {
	const originalPlatform = process.platform;

	afterEach(() => {
		createdWindows.length = 0;
		vi.clearAllMocks();
		vi.mocked(isTrustedRendererUrl).mockReturnValue(true);
		Object.defineProperty(process, "platform", { value: originalPlatform });
	});

	it("paints window chrome from the cached scheme at creation", () => {
		const windows = new ElectronWindow(createShell() as never, () => true);
		windows.create({ isDevelopment: false });
		expect(createdWindows[0]?.options.backgroundColor).toBe(themeChromeColors.dark.background);

		createdWindows.length = 0;
		const lightWindows = new ElectronWindow(createShell() as never, () => false);
		lightWindows.create({ isDevelopment: false });
		expect(createdWindows[0]?.options.backgroundColor).toBe(themeChromeColors.light.background);
	});

	it("sets the title-bar overlay colors at creation on non-darwin platforms", () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const windows = new ElectronWindow(createShell() as never, () => true);
		windows.create({ isDevelopment: false });
		expect(createdWindows[0]?.options.titleBarOverlay).toMatchObject({
			color: themeChromeColors.dark.background,
			symbolColor: themeChromeColors.dark.foreground,
		});
	});

	it("shows the window on ready-to-show and tracks the main window until closed", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];

		const readyToShow = window?.once.mock.calls.find((call) => call[0] === "ready-to-show")?.[1];
		readyToShow?.();
		expect(window?.show).toHaveBeenCalled();
		expect(windows.main).toBe(window);

		const closed = window?.on.mock.calls.find((call) => call[0] === "closed")?.[1];
		closed?.();
		expect(windows.main).toBeUndefined();
	});

	it("returns no main window when it was destroyed", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];
		window?.isDestroyed.mockReturnValue(true);
		expect(windows.main).toBeUndefined();
	});

	it("denies window.open and routes external URLs through the shell", () => {
		const shell = createShell();
		const windows = new ElectronWindow(shell as never, () => false);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];

		const openHandler = window?.webContents.setWindowOpenHandler.mock.calls[0]?.[0];
		expect(openHandler?.({ url: "https://example.com" })).toEqual({ action: "deny" });
		expect(shell.openExternal).toHaveBeenCalledWith("https://example.com");
	});

	it("allows trusted navigation and blocks untrusted navigation", () => {
		const shell = createShell();
		const windows = new ElectronWindow(shell as never, () => false);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];

		const willNavigate = window?.webContents.on.mock.calls.find(
			(call) => call[0] === "will-navigate",
		)?.[1];
		const trustedEvent = { preventDefault: vi.fn() };
		willNavigate?.(trustedEvent, "desktop://app");
		expect(trustedEvent.preventDefault).not.toHaveBeenCalled();

		vi.mocked(isTrustedRendererUrl).mockReturnValue(false);
		const untrustedEvent = { preventDefault: vi.fn() };
		willNavigate?.(untrustedEvent, "https://phishing.example");
		expect(untrustedEvent.preventDefault).toHaveBeenCalled();
		expect(shell.openExternal).toHaveBeenCalledWith("https://phishing.example");
	});

	it("repaints live windows when the renderer pushes a new scheme", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];

		windows.applyColorScheme(true);
		expect(window?.setBackgroundColor).toHaveBeenCalledWith(themeChromeColors.dark.background);

		windows.applyColorScheme(false);
		expect(window?.setBackgroundColor).toHaveBeenCalledWith(themeChromeColors.light.background);
	});

	it("updates the title-bar overlay on non-darwin platforms only", () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];

		windows.applyColorScheme(true);
		expect(window?.setTitleBarOverlay).toHaveBeenCalledWith({
			color: themeChromeColors.dark.background,
			symbolColor: themeChromeColors.dark.foreground,
		});
	});

	it("skips the overlay on darwin", () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];

		windows.applyColorScheme(true);
		expect(window?.setTitleBarOverlay).not.toHaveBeenCalled();
	});

	it("reveals the main window: restore, show, focus", () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];
		window?.isMinimized.mockReturnValue(true);

		windows.reveal();
		expect(window?.restore).toHaveBeenCalled();
		expect(window?.show).toHaveBeenCalled();
		expect(window?.focus).toHaveBeenCalled();
		expect(electronApp.focus).toHaveBeenCalledWith({ steal: true });
	});

	it("skips app focus on non-darwin reveal and ignores missing windows", () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.reveal();
		expect(electronApp.focus).not.toHaveBeenCalled();

		windows.create({ isDevelopment: false });
		const window = createdWindows[0];
		window?.isVisible.mockReturnValue(true);
		windows.reveal();
		expect(window?.show).not.toHaveBeenCalled();
		expect(electronApp.focus).not.toHaveBeenCalled();
	});

	it("destroys all live windows", () => {
		const windows = new ElectronWindow(createShell() as never, () => false);
		windows.create({ isDevelopment: false });
		const window = createdWindows[0];

		windows.destroyAll();
		expect(window?.destroy).toHaveBeenCalled();
		expect(windows.main).toBeUndefined();
	});
});
