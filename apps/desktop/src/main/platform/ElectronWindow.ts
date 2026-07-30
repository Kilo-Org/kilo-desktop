import path from "node:path";

import { app, BrowserWindow, type BrowserWindowConstructorOptions } from "electron";

import {
	ipcEvents,
	type IpcEventChannel,
	type IpcEventPayload,
} from "@anaconda-agentic-desktop/contracts";

import { getDesktopUrl } from "./ElectronProtocol.js";
import { isTrustedRendererUrl } from "./ElectronSecurity.js";
import type { ElectronShell } from "./ElectronShell.js";

/** Matches the app header band (p-3 + 32px control). */
const TITLEBAR_HEIGHT = 56;
const TRAFFIC_LIGHT_SIZE = 14;

export class ElectronWindow {
	#mainWindow: BrowserWindow | undefined;

	constructor(private readonly electronShell: ElectronShell) {}

	create(input: {
		readonly isDevelopment: boolean;
		readonly preloadPath?: string;
		readonly options?: BrowserWindowConstructorOptions;
	}): BrowserWindow {
		const window = new BrowserWindow({
			title: "Anaconda Agentic Desktop",
			width: 960,
			height: 720,
			minWidth: 720,
			minHeight: 520,
			show: false,
			backgroundColor: "#f4f5f8",
			...titleBarOptions(),
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
		window.once("ready-to-show", () => window.show());
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

	broadcast<TChannel extends IpcEventChannel>(
		channel: TChannel,
		payload: IpcEventPayload<TChannel>,
	): void {
		const validatedPayload = ipcEvents[channel].payload.parse(payload);
		for (const window of this.liveWindows) {
			window.webContents.send(channel, validatedPayload);
		}
	}

	destroyAll(): void {
		for (const window of this.liveWindows) window.destroy();
		this.#mainWindow = undefined;
	}
}

function titleBarOptions(): BrowserWindowConstructorOptions {
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
			height: TITLEBAR_HEIGHT,
			color: "#f4f5f8",
			symbolColor: "#1a1a1a",
		},
	};
}
