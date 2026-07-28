import path from "node:path";

import electronDebug from "electron-debug";
import { session } from "electron";

import type { IpcHandlers } from "$shared";

import { createShellHandlers } from "./features/shell/handlers.js";
import { createThemeHandlers } from "./features/theme/handlers.js";
import { createTodoHandlers } from "./features/todos/handlers.js";
import { TodoService } from "./features/todos/TodoService.js";
import { createDatabase, resolveMigrationsFolder } from "./platform/db/client.js";
import { ElectronApp } from "./platform/ElectronApp.js";
import { ElectronProtocol } from "./platform/ElectronProtocol.js";
import { ElectronSecurity } from "./platform/ElectronSecurity.js";
import { ElectronShell } from "./platform/ElectronShell.js";
import { ElectronTheme } from "./platform/ElectronTheme.js";
import { ElectronWindow } from "./platform/ElectronWindow.js";
import { IpcServer } from "./platform/IpcServer.js";
import { PreferencesStore } from "./platform/PreferencesStore.js";
import { configureUpdater } from "./platform/Updater.js";

export class Application {
	readonly #app = new ElectronApp();
	readonly #protocol = new ElectronProtocol();
	readonly #security = new ElectronSecurity();
	readonly #shell = new ElectronShell();
	readonly #theme = new ElectronTheme();
	readonly #preferences = new PreferencesStore();
	readonly #windows = new ElectronWindow(this.#shell);
	readonly #ipcServer = new IpcServer();
	readonly #disposers: Array<() => void> = [];
	#todoService: TodoService | undefined;
	#isShuttingDown = false;

	async start(): Promise<void> {
		this.#app.setIdentity();
		if (!this.#app.requestSingleInstanceLock()) {
			this.#app.quit();
			return;
		}

		this.#disposers.push(
			this.#app.on("second-instance", () => this.#windows.reveal()),
			this.#app.on("before-quit", () => this.#dispose()),
		);

		await this.#app.whenReady();
		const isDevelopment = !this.#app.metadata.isPackaged;
		if (isDevelopment) {
			electronDebug({ showDevTools: false });
		}

		const savedTheme = this.#preferences.themeSource;
		if (savedTheme) this.#theme.setSource(savedTheme);

		this.#todoService = new TodoService(
			createDatabase(path.join(this.#app.getPath("userData"), "app.db"), resolveMigrationsFolder()),
		);

		this.#disposers.push(configureUpdater());
		this.#protocol.register({
			isDevelopment,
			rendererRoot: path.join(import.meta.dirname, "../renderer/main_window"),
			...(MAIN_WINDOW_VITE_DEV_SERVER_URL
				? { developmentOrigin: MAIN_WINDOW_VITE_DEV_SERVER_URL }
				: {}),
		});

		this.#disposers.push(this.#security.install(session.defaultSession));
		this.#registerIpc();
		this.#registerPushEvents();
		this.#createWindow(isDevelopment);

		this.#disposers.push(
			this.#app.on("activate", () => {
				if (this.#windows.liveWindows.length === 0) this.#createWindow(isDevelopment);
				else this.#windows.reveal();
			}),
			this.#app.on("window-all-closed", () => {
				if (process.platform !== "darwin") this.#app.quit();
			}),
		);
	}

	#createWindow(isDevelopment: boolean): void {
		this.#windows.create({ isDevelopment });
	}

	#registerIpc(): void {
		const todoService = this.#todoService;
		if (!todoService) {
			throw new Error("TodoService must be created before IPC registration.");
		}

		const handlers = {
			...createShellHandlers(this.#shell),
			...createThemeHandlers(this.#theme, this.#preferences),
			...createTodoHandlers(todoService),
		} satisfies IpcHandlers;
		this.#ipcServer.register(handlers);
		this.#disposers.push(() => this.#ipcServer.dispose());
	}

	#registerPushEvents(): void {
		this.#disposers.push(
			this.#theme.onUpdated((state) => {
				this.#windows.broadcast("theme:changed", state);
			}),
		);
	}

	#dispose(): void {
		if (this.#isShuttingDown) return;
		this.#isShuttingDown = true;
		for (const dispose of this.#disposers.splice(0).reverse()) dispose();
		this.#protocol.dispose();
	}
}
