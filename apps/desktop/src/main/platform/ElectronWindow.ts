import path from "node:path";

import { app, BrowserWindow, screen, type BrowserWindowConstructorOptions } from "electron";

import { DEFAULT_APP_THEME_PREFERENCES, getThemeChrome } from "@kilo-desktop/ui/themes/app-themes";
import {
	chromeFor,
	windowBackgroundFor,
	type ThemeChromeColors,
} from "@kilo-desktop/ui/themes/theme-tokens";

import type { EmbeddedWebHost } from "./embedded-web-host.js";
import { BROWSER_PARTITION } from "./ElectronBrowserHost.js";
import { attachContextMenu } from "./ElectronContextMenu.js";
import { getDesktopUrl } from "./ElectronProtocol.js";
import { isPinnedEmbeddedFrame, isTrustedRendererUrl } from "./ElectronSecurity.js";
import type { ElectronShell } from "./ElectronShell.js";

type ThemeChromeByScheme = Readonly<Record<"light" | "dark", ThemeChromeColors>>;

/** Matches the app header band (`h-12` = 48px). */
const TITLEBAR_HEIGHT = 48;
const TITLEBAR_OVERLAY_HEIGHT = TITLEBAR_HEIGHT - 1;
const TRAFFIC_LIGHT_SIZE = 14;

/**
 * Owns the main BrowserWindow and the secondary windows opened beside it.
 * Chrome uses the colours last supplied at runtime (kernel/native-theme),
 * falling back to the app's default palette before the first sync; macOS
 * retains native vibrancy regardless of the selected palette.
 */
export class ElectronWindow {
	#mainWindow: BrowserWindow | undefined;

	constructor(
		private readonly electronShell: ElectronShell,
		private readonly shouldUseDarkColors: () => boolean,
		private readonly chromeColors: () => ThemeChromeByScheme | undefined = () => undefined,
		/** Read per navigation: features register their hosts after windows exist. */
		private readonly embeddedHosts: () => readonly EmbeddedWebHost[] = () => [],
	) {}

	create(input: {
		readonly isDevelopment: boolean;
		readonly preloadPath?: string;
		readonly options?: BrowserWindowConstructorOptions;
		/** When true, the window is not shown on ready-to-show. Use `reveal()` to show it. */
		readonly deferShow?: boolean;
	}): BrowserWindow {
		const window = this.#createWindow(input.isDevelopment, input.preloadPath, {
			// The saved size and position are keyed by name, which Electron requires
			// to be unique: only the main window has one, so pop-outs can open.
			name: app.getName(),
			windowStatePersistence: true,
			...input.options,
			webPreferences: {
				...input.options?.webPreferences,
				webviewTag: true,
			},
		});

		this.#mainWindow = window;
		if (!input.deferShow) {
			window.once("ready-to-show", () => window.show());
		}
		window.on("closed", () => {
			if (this.#mainWindow === window) this.#mainWindow = undefined;
		});
		void window.loadURL(getDesktopUrl(input.isDevelopment));
		return window;
	}

	/**
	 * A plugin-independent secondary window. Its identity (id, view, params)
	 * reaches the preload through `additionalArguments`; it shows when ready
	 * and follows the main window only by being closed with it. That close is
	 * a `destroy()`: the main window's close already passed the kernel's close
	 * veto, and a vetoed pop-out would outlive the window it belongs to.
	 */
	openSecondary(input: {
		readonly isDevelopment: boolean;
		readonly title: string;
		readonly width?: number;
		readonly height?: number;
		readonly additionalArguments: readonly string[];
	}): BrowserWindow {
		const window = this.#createWindow(input.isDevelopment, undefined, {
			title: input.title,
			...this.#secondaryWindowWidth(input.width),
			...(input.height === undefined ? {} : { height: input.height }),
			webPreferences: {
				additionalArguments: [...input.additionalArguments],
				// Pop-outs host the same plugin panes as the main window, including
				// the Browser pane's <webview>; without this it renders blank.
				// Guests are still constrained by the will-attach-webview guard.
				webviewTag: true,
			},
		});
		window.once("ready-to-show", () => window.show());
		const main = this.main;
		if (main) {
			const closeWithMain = () => {
				if (!window.isDestroyed()) window.destroy();
			};
			main.once("closed", closeWithMain);
			window.once("closed", () => main.off("closed", closeWithMain));
		}
		void window.loadURL(getDesktopUrl(input.isDevelopment));
		return window;
	}

	/**
	 * Returns a promise that resolves when the main window is ready to show.
	 * Call after `create({ deferShow: true })` to know when the renderer is painted.
	 * Times out after 10s to prevent hanging forever if ready-to-show never fires.
	 */
	whenReady(): Promise<void> {
		const window = this.#mainWindow;
		if (!window || window.isDestroyed()) return Promise.resolve();
		return new Promise((resolve) => {
			const timeout = setTimeout(() => resolve(), 10_000);
			window.once("ready-to-show", () => {
				clearTimeout(timeout);
				resolve();
			});
		});
	}

	get main(): BrowserWindow | undefined {
		if (!this.#mainWindow || this.#mainWindow.isDestroyed()) return undefined;
		return this.#mainWindow;
	}

	get liveWindows(): readonly BrowserWindow[] {
		return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
	}

	reveal(window = this.main): void {
		if (!window || window.isDestroyed()) return;
		if (window.isMinimized()) window.restore();
		if (!window.isVisible()) window.show();
		if (process.platform === "darwin") app.focus({ steal: true });
		window.focus();
	}

	/** Repaints native chrome to match the renderer-owned theme (pushed via `theme:sync`). */
	applyColorScheme(): void {
		const shouldUseDarkColors = this.shouldUseDarkColors();
		const colors = this.chromeColors() ?? getThemeChrome(DEFAULT_APP_THEME_PREFERENCES.themeId);
		const chrome = chromeFor(shouldUseDarkColors, colors);
		const background = windowBackgroundFor(shouldUseDarkColors, process.platform, colors);
		for (const window of this.liveWindows) {
			window.setBackgroundColor(background);
			if (process.platform === "darwin") continue;
			// Electron throws "Titlebar overlay is not enabled" from
			// setTitleBarOverlay while the overlay is inactive (e.g. a fullscreen
			// window on Windows). That is a benign, transient state: the overlay
			// repaints on the next sync once it leaves fullscreen, so swallow it
			// here rather than aborting the repaint of the remaining windows.
			try {
				window.setTitleBarOverlay({
					color: chrome.background,
					symbolColor: chrome.foreground,
				});
			} catch {
				// Overlay is not currently paintable; skip this window.
			}
		}
	}

	destroyAll(): void {
		for (const window of this.liveWindows) window.destroy();
		this.#mainWindow = undefined;
	}

	isTrustedWebContents(webContentsId: number): boolean {
		return this.liveWindows.some((window) => window.webContents.id === webContentsId);
	}

	#createWindow(
		isDevelopment: boolean,
		preloadPath?: string,
		options?: BrowserWindowConstructorOptions,
	): BrowserWindow {
		const dark = this.shouldUseDarkColors();
		const colors = this.chromeColors() ?? getThemeChrome(DEFAULT_APP_THEME_PREFERENCES.themeId);
		const chrome = chromeFor(dark, colors);
		const appName = app.getName();
		const window = new BrowserWindow({
			title: appName,
			width: 1280,
			height: 860,
			minWidth: 720,
			minHeight: 520,
			show: false,
			backgroundColor: windowBackgroundFor(dark, process.platform, colors),
			...systemMaterialOptions(),
			...(process.platform === "linux" ? { icon: linuxWindowIcon() } : {}),
			...titleBarOptions(chrome),
			...options,
			webPreferences: {
				preload: preloadPath ?? path.join(import.meta.dirname, "preload.cjs"),
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				webviewTag: false,
				...options?.webPreferences,
				// After the caller spread so a caller cannot re-enable it.
				devTools: !app.isPackaged,
				// Runs the preload in subframes too, where it strips WebRTC from
				// untrusted content (see preload/subframe-webrtc.ts). The sandbox
				// keeps Node out of every frame regardless.
				nodeIntegrationInSubFrames: true,
				additionalArguments: [...(options?.webPreferences?.additionalArguments ?? [])],
			},
		});
		// The renderer's static <title> would otherwise replace the per-track app
		// name (e.g. "Kilo Preview"); titles change only through `setTitle`.
		window.on("page-title-updated", (event) => event.preventDefault());
		window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
			if (params.partition !== BROWSER_PARTITION || params.preload) {
				event.preventDefault();
				return;
			}
			webPreferences.sandbox = true;
			webPreferences.contextIsolation = true;
			webPreferences.nodeIntegration = false;
			webPreferences.nodeIntegrationInSubFrames = false;
			webPreferences.webSecurity = true;
			webPreferences.allowRunningInsecureContent = false;
			delete webPreferences.preload;
		});
		window.webContents.setWindowOpenHandler(({ url }) => {
			void this.electronShell.openExternal(url);
			return { action: "deny" };
		});
		window.webContents.on("will-navigate", (event, url) => {
			if (isTrustedRendererUrl(url)) return;
			event.preventDefault();
			void this.electronShell.openExternal(url);
		});
		// Below the per-realm strip: with no proxy, WebRTC still reaches TURN
		// over TCP, but no frame can send UDP to a STUN or TURN server.
		window.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
		window.webContents.on("will-frame-navigate", (details) => {
			if (details.isMainFrame || details.isSameDocument) return;
			if (isPinnedEmbeddedFrame(details.frame?.url, this.embeddedHosts())) details.preventDefault();
		});
		attachContextMenu(window.webContents, {
			isDevelopment,
			shell: this.electronShell,
		});
		return window;
	}

	/** A requested width sizes the content, capped to the display the main window is on. */
	#secondaryWindowWidth(width: number | undefined): BrowserWindowConstructorOptions {
		if (width === undefined) return { width: 960 };
		const display = this.main
			? screen.getDisplayMatching(this.main.getBounds())
			: screen.getPrimaryDisplay();
		return { width: Math.min(width, display.workArea.width), useContentSize: true };
	}
}

function systemMaterialOptions(): BrowserWindowConstructorOptions {
	if (process.platform === "darwin") {
		return {
			vibrancy: "under-window",
			visualEffectState: "active",
		};
	}
	return {};
}

function titleBarOptions(chrome: ThemeChromeColors): BrowserWindowConstructorOptions {
	if (process.platform === "darwin") {
		return {
			titleBarStyle: "hidden",
			trafficLightPosition: {
				x: 16,
				y: Math.round((TITLEBAR_HEIGHT - TRAFFIC_LIGHT_SIZE) / 2),
			},
		};
	}

	return {
		titleBarStyle: "hidden",
		titleBarOverlay: {
			height: TITLEBAR_OVERLAY_HEIGHT,
			color: chrome.background,
			symbolColor: chrome.foreground,
		},
	};
}

function linuxWindowIcon(): string {
	return app.isPackaged
		? path.join(process.resourcesPath, "icon.png")
		: path.join(app.getAppPath(), "assets/icon.png");
}
