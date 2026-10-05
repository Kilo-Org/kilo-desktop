import path from "node:path";

import { app, BrowserWindow, type BrowserWindowConstructorOptions } from "electron";

import {
	chromeFor,
	DEFAULT_APP_THEME_PREFERENCES,
	getThemeChrome,
	ipcEvents,
	type IpcEventChannel,
	type IpcEventPayload,
	type PaneWindow,
	type ThemeChromeColors,
	type ShellNavigationTarget,
	windowBackgroundFor,
} from "@kilo-desktop/contracts";

import { getDesktopRouteUrl, getDesktopUrl } from "./ElectronProtocol.js";
import { isTrustedRendererUrl } from "./ElectronSecurity.js";
import type { ElectronShell } from "./ElectronShell.js";
import { BROWSER_PARTITION } from "./ElectronBrowserHost.js";
import { attachContextMenu } from "./ElectronContextMenu.js";

type WebMcpRendezvous = {
	readonly port: number;
	readonly relayId: string;
};

const DEFAULT_WEBMCP_RENDEZVOUS: WebMcpRendezvous = {
	port: 9345,
	relayId: "kilo-desktop",
};

/** Matches the app header band (`h-12` = 48px). */
const TITLEBAR_HEIGHT = 48;
const TITLEBAR_OVERLAY_HEIGHT = TITLEBAR_HEIGHT - 1;
const TRAFFIC_LIGHT_SIZE = 14;

type PaneWindowRecord = {
	descriptor: PaneWindow;
	window: BrowserWindow;
	ready: boolean;
};

/**
 * Owns the main BrowserWindow and session-scoped pane windows. Pane windows
 * remain keyed by plugin/session/pane identity, are hidden when their session
 * is inactive, and emit one lifecycle event whenever native window state
 * changes so renderer tabs remain the source of navigation truth.
 * Chrome reads the last renderer-synced preferences on creation and repaint,
 * falling back to the app's default palette before the first renderer sync;
 * macOS retains native vibrancy regardless of the selected palette.
 */
export class ElectronWindow {
	#mainWindow: BrowserWindow | undefined;
	#isDevelopment = false;
	readonly #paneWindows = new Map<string, PaneWindowRecord>();
	readonly #activePaneSessions = new Map<string, string | null>();

	constructor(
		private readonly electronShell: ElectronShell,
		private readonly shouldUseDarkColors: () => boolean,
		private readonly themeId: () => string | undefined = () => undefined,
		private readonly webmcpRendezvous: WebMcpRendezvous = DEFAULT_WEBMCP_RENDEZVOUS,
	) {}

	create(input: {
		readonly isDevelopment: boolean;
		readonly preloadPath?: string;
		readonly options?: BrowserWindowConstructorOptions;
		/** When true, the window is not shown on ready-to-show. Use `reveal()` to show it. */
		readonly deferShow?: boolean;
		readonly initialRoute?: ShellNavigationTarget;
	}): BrowserWindow {
		const window = this.#createWindow(input.isDevelopment, input.preloadPath, {
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
			if (this.#mainWindow !== window) return;
			this.#mainWindow = undefined;
			for (const record of this.#paneWindows.values()) record.window.close();
		});
		window.on("hide", () => this.#hidePaneWindows());
		window.on("minimize", () => this.#hidePaneWindows());
		window.on("show", () => this.#refreshPaneWindows());
		window.on("restore", () => this.#refreshPaneWindows());
		this.#isDevelopment = input.isDevelopment;
		void window.loadURL(
			input.initialRoute
				? getDesktopRouteUrl(
						input.isDevelopment,
						input.initialRoute.path,
						input.initialRoute.search,
					)
				: getDesktopUrl(input.isDevelopment),
		);
		return window;
	}

	loadMainRoute(target: ShellNavigationTarget): void {
		const window = this.main;
		if (!window) return;
		void window.loadURL(getDesktopRouteUrl(this.#isDevelopment, target.path, target.search));
	}

	navigateMain(target: ShellNavigationTarget): void {
		const window = this.main;
		if (!window) return;
		window.webContents.send("shell:navigate", ipcEvents["shell:navigate"].payload.parse(target));
	}

	openPaneWindow(descriptor: PaneWindow, isDevelopment: boolean): { opened: boolean } {
		const key = paneWindowKey(descriptor);
		const existing = this.#paneWindows.get(key);
		if (existing && !existing.window.isDestroyed()) {
			this.reveal(existing.window);
			return { opened: false };
		}

		const window = this.#createWindow(isDevelopment, undefined, {
			title: descriptor.title,
			name: paneWindowName(descriptor),
			width: 960,
			height: 720,
			minWidth: 480,
			minHeight: 360,
			webPreferences: {
				// Pane windows can host the same plugin panes as the main window,
				// including the browser pane's <webview>. Without this the popped-out
				// browser renders a blank surface. The will-attach-webview guard in
				// #createWindow still restricts guests to BROWSER_PARTITION.
				webviewTag: true,
				additionalArguments: ["--kilo-window-role=pane"],
			},
		});
		const record: PaneWindowRecord = { descriptor, window, ready: false };
		this.#paneWindows.set(key, record);

		window.once("ready-to-show", () => {
			record.ready = true;
			if (!this.#isPaneSessionActive(descriptor) || !this.main?.isVisible()) return;
			window.show();
			window.focus();
		});
		window.on("focus", () => this.#emitPaneWindowEvent(record, "focused"));
		window.on("blur", () => this.#emitPaneWindowEvent(record, "blurred"));
		window.on("closed", () => {
			if (this.#paneWindows.get(key) !== record) return;
			this.#paneWindows.delete(key);
			this.#emitPaneWindowEvent(record, "docked");
		});
		void window.loadURL(
			getDesktopRouteUrl(isDevelopment, descriptor.path, {
				paneWindow: "true",
				panePluginId: descriptor.pluginId,
				paneSessionId: descriptor.sessionId,
				paneId: descriptor.paneId,
				...(descriptor.workspaceId ? { paneWorkspaceId: descriptor.workspaceId } : {}),
			}),
		);
		this.#emitPaneWindowEvent(record, "opened");
		return { opened: true };
	}

	listPaneWindows(pluginId: string): PaneWindow[] {
		return [...this.#paneWindows.values()]
			.filter((record) => record.descriptor.pluginId === pluginId && !record.window.isDestroyed())
			.map((record) => record.descriptor);
	}

	focusPaneWindow(identity: Pick<PaneWindow, "pluginId" | "sessionId" | "paneId">): {
		focused: boolean;
	} {
		const record = this.#paneWindows.get(paneWindowKey(identity));
		if (!record || record.window.isDestroyed()) return { focused: false };
		this.reveal(record.window);
		return { focused: true };
	}

	dockPaneWindow(identity: Pick<PaneWindow, "pluginId" | "sessionId" | "paneId">): {
		docked: boolean;
	} {
		const record = this.#paneWindows.get(paneWindowKey(identity));
		if (!record || record.window.isDestroyed()) return { docked: false };
		record.window.close();
		return { docked: true };
	}

	syncPaneWindows(pluginId: string, activeSessionId: string | null): void {
		this.#activePaneSessions.set(pluginId, activeSessionId);
		this.#refreshPaneWindows(pluginId);
	}

	#hidePaneWindows(): void {
		for (const record of this.#paneWindows.values()) {
			if (!record.window.isDestroyed() && record.window.isVisible()) record.window.hide();
		}
	}

	#refreshPaneWindows(pluginId?: string): void {
		for (const record of this.#paneWindows.values()) {
			if (
				(pluginId && record.descriptor.pluginId !== pluginId) ||
				!record.ready ||
				record.window.isDestroyed()
			) {
				continue;
			}
			const activeSessionId = this.#activePaneSessions.get(record.descriptor.pluginId);
			if (
				(activeSessionId === undefined || record.descriptor.sessionId === activeSessionId) &&
				this.main?.isVisible()
			) {
				if (!record.window.isVisible()) record.window.showInactive();
				continue;
			}
			if (record.window.isVisible()) record.window.hide();
		}
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
	applyColorScheme(): void {
		const shouldUseDarkColors = this.shouldUseDarkColors();
		const colors = getThemeChrome(this.themeId() ?? DEFAULT_APP_THEME_PREFERENCES.themeId);
		const chrome = chromeFor(shouldUseDarkColors, colors);
		const background = windowBackgroundFor(shouldUseDarkColors, process.platform, colors);
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
		this.#paneWindows.clear();
		this.#activePaneSessions.clear();
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
		const colors = getThemeChrome(this.themeId() ?? DEFAULT_APP_THEME_PREFERENCES.themeId);
		const chrome = chromeFor(dark, colors);
		const appName = app.getName();
		const window = new BrowserWindow({
			title: appName,
			name: appName,
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
				preload: preloadPath ?? path.join(import.meta.dirname, "preload.js"),
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				webviewTag: false,
				...options?.webPreferences,
				additionalArguments: [
					`--kilo-webmcp-port=${this.webmcpRendezvous.port}`,
					`--kilo-webmcp-relay-id=${this.webmcpRendezvous.relayId}`,
					...(options?.webPreferences?.additionalArguments ?? []),
				],
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
		attachContextMenu(window.webContents, {
			isDevelopment,
			shell: this.electronShell,
		});
		return window;
	}

	#isPaneSessionActive(descriptor: PaneWindow): boolean {
		const active = this.#activePaneSessions.get(descriptor.pluginId);
		return active === undefined || active === descriptor.sessionId;
	}

	#emitPaneWindowEvent(
		record: PaneWindowRecord,
		type: "opened" | "docked" | "focused" | "blurred",
	): void {
		this.broadcast("shell:pane-window-changed", {
			type,
			pluginId: record.descriptor.pluginId,
			sessionId: record.descriptor.sessionId,
			paneId: record.descriptor.paneId,
		});
	}

	#forSender(senderId: number): BrowserWindow | undefined {
		return this.liveWindows.find((window) => window.webContents.id === senderId);
	}
}

function paneWindowKey(identity: Pick<PaneWindow, "pluginId" | "sessionId" | "paneId">): string {
	return JSON.stringify([identity.pluginId, identity.sessionId, identity.paneId]);
}

function paneWindowName(identity: Pick<PaneWindow, "pluginId" | "sessionId" | "paneId">): string {
	return `pane:${identity.pluginId}:${identity.sessionId}:${identity.paneId}`;
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
