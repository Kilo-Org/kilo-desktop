import path from "node:path";

import { app, BrowserWindow, type BrowserWindowConstructorOptions } from "electron";

import {
	chromeFor,
	ipcEvents,
	type IpcEventChannel,
	type IpcEventPayload,
	type ThemeChromeColors,
	windowBackgroundFor,
} from "@anaconda-agentic-desktop/contracts";

import { getDesktopUrl } from "./ElectronProtocol.js";
import { isTrustedRendererUrl } from "./ElectronSecurity.js";
import type { ElectronShell } from "./ElectronShell.js";

/** Matches the app header band (`h-12` = 48px). */
const TITLEBAR_HEIGHT = 48;
const TITLEBAR_OVERLAY_HEIGHT = TITLEBAR_HEIGHT - 1;
const TRAFFIC_LIGHT_SIZE = 14;

export class ElectronWindow {
	#mainWindow: BrowserWindow | undefined;

	constructor(
		private readonly electronShell: ElectronShell,
		private readonly shouldUseDarkColors: () => boolean,
	) {}

	create(input: {
		readonly isDevelopment: boolean;
		readonly preloadPath?: string;
		readonly options?: BrowserWindowConstructorOptions;
		/** When true, the window is not shown on ready-to-show. Use `reveal()` to show it. */
		readonly deferShow?: boolean;
	}): BrowserWindow {
		const chrome = chromeFor(this.shouldUseDarkColors());
		const appName = app.getName();
		const window = new BrowserWindow({
			title: appName,
			name: appName,
			width: 1280,
			height: 860,
			minWidth: 720,
			minHeight: 520,
			windowStatePersistence: true,
			show: false,
			backgroundColor: windowBackgroundFor(this.shouldUseDarkColors()),
			...systemMaterialOptions(),
			...(process.platform === "linux" ? { icon: linuxWindowIcon() } : {}),
			...titleBarOptions(chrome),
			...input.options,
			webPreferences: {
				preload: input.preloadPath ?? path.join(import.meta.dirname, "preload.js"),
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				webviewTag: false,
				...input.options?.webPreferences,
			},
		});

		this.#mainWindow = window;
		if (!input.deferShow) {
			window.once("ready-to-show", () => window.show());
		}
		window.on("closed", () => {
			if (this.#mainWindow === window) this.#mainWindow = undefined;
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

	getTitle(senderId: number): string {
		return this.#forSender(senderId)?.getTitle() ?? "";
	}

	setTitle(senderId: number, title: string): void {
		this.#forSender(senderId)?.setTitle(title);
	}

	isFocused(senderId: number): boolean {
		return this.#forSender(senderId)?.isFocused() ?? false;
	}

	onFocusChange(senderId: number, listener: (focused: boolean) => void): () => void {
		const window = this.#forSender(senderId);
		if (!window) return () => {};
		const onFocus = () => listener(true);
		const onBlur = () => listener(false);
		window.on("focus", onFocus);
		window.on("blur", onBlur);
		return () => {
			window.off("focus", onFocus);
			window.off("blur", onBlur);
		};
	}

	reveal(window = this.main): void {
		if (!window || window.isDestroyed()) return;
		if (window.isMinimized()) window.restore();
		if (!window.isVisible()) window.show();
		if (process.platform === "darwin") app.focus({ steal: true });
		window.focus();
	}

	broadcast<TChannel extends IpcEventChannel>(
		channel: TChannel,
		payload: IpcEventPayload<TChannel>,
		excludeSenderId?: number,
	): void {
		const validatedPayload = ipcEvents[channel].payload.parse(payload);
		for (const window of this.liveWindows) {
			if (excludeSenderId !== undefined && window.webContents.id === excludeSenderId) continue;
			window.webContents.send(channel, validatedPayload);
		}
	}

	/** Repaints native chrome to match the renderer-owned theme (pushed via `theme:sync`). */
	applyColorScheme(shouldUseDarkColors: boolean): void {
		const chrome = chromeFor(shouldUseDarkColors);
		const background = windowBackgroundFor(shouldUseDarkColors);
		for (const window of this.liveWindows) {
			window.setBackgroundColor(background);
			if (process.platform !== "darwin") {
				window.setTitleBarOverlay({
					color: chrome.background,
					symbolColor: chrome.foreground,
				});
			}
		}
	}

	destroyAll(): void {
		for (const window of this.liveWindows) window.destroy();
		this.#mainWindow = undefined;
	}

	#forSender(senderId: number): BrowserWindow | undefined {
		return this.liveWindows.find((window) => window.webContents.id === senderId);
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
