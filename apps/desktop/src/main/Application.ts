import electronDebug from "electron-debug";
import { nativeTheme, session } from "electron";
import path from "node:path";

import type { IpcHandlers } from "@anaconda-agentic-desktop/contracts";

import { getAppIdentity } from "$config/app-identity.js";

import { bootFeatures, createFeatureHandlers } from "./features/registry/feature-registry.js";
import { FEATURES } from "./features/registry/features.js";
import { AuthSessionService } from "./features/auth/auth-service.js";
import { createAuthHandlers } from "./features/auth/handlers.js";
import { createFsHandlers } from "./features/fs/handlers.js";
import { createNotificationsHandlers } from "./features/notifications/handlers.js";
import { createShellHandlers } from "./features/shell/handlers.js";
import {
	createThemeHandlers,
	restoreNativeThemeFromPreferences,
} from "./features/theme/handlers.js";
import { ElectronApp } from "./platform/ElectronApp.js";
import { ElectronNotifications } from "./platform/ElectronNotifications.js";
import { ElectronProtocol } from "./platform/ElectronProtocol.js";
import { ElectronSecurity } from "./platform/ElectronSecurity.js";
import { ElectronShell } from "./platform/ElectronShell.js";
import { ElectronWindow } from "./platform/ElectronWindow.js";
import { IpcServer } from "./platform/IpcServer.js";
import { PreferencesStore } from "./platform/PreferencesStore.js";
import { ScopedFsService } from "./platform/ScopedFsService.js";
import { configureUpdater } from "./platform/Updater.js";
import { getProductionRendererRoot, getWebDevServerUrl } from "./platform/webDevServer.js";

export class Application {
	readonly #app = new ElectronApp();
	readonly #protocol = new ElectronProtocol();
	readonly #security = new ElectronSecurity();
	readonly #shell = new ElectronShell();
	readonly #notifications = new ElectronNotifications();
	// sdk.fs sandbox — same per-feature root as mainSdk.storageDir (Decision #20).
	readonly #scopedFs = new ScopedFsService((featureId) =>
		path.join(this.#app.getPath("userData"), "plugins", featureId),
	);
	readonly #auth = new AuthSessionService({
		userAgent: `anaconda-agentic-desktop/${this.#app.metadata.appVersion}`,
	});
	// After restoreNativeThemeFromPreferences, nativeTheme is the chrome signal.
	readonly #windows = new ElectronWindow(this.#shell, () => nativeTheme.shouldUseDarkColors);
	readonly #ipcServer = new IpcServer();
	readonly #disposers: Array<() => void> = [];
	#isShuttingDown = false;

	async start(): Promise<void> {
		const identity = getAppIdentity(
			this.#app.metadata.isPackaged ? RELEASE_CHANNEL : "development",
		);
		this.#app.setIdentity(identity);
		if (!this.#app.requestSingleInstanceLock()) {
			this.#app.quit();
			return;
		}
		const preferences = new PreferencesStore();

		this.#disposers.push(
			this.#app.on("second-instance", () => this.#windows.reveal()),
			this.#app.on("before-quit", () => this.#dispose()),
		);

		await this.#app.whenReady();
		const isDevelopment = !this.#app.metadata.isPackaged;
		if (isDevelopment) {
			electronDebug({ showDevTools: false });
		}

		this.#disposers.push(configureUpdater());
		const developmentOrigin = getWebDevServerUrl();
		this.#protocol.register({
			isDevelopment,
			rendererRoot: getProductionRendererRoot(import.meta.dirname),
			...(developmentOrigin ? { developmentOrigin } : {}),
		});

		this.#disposers.push(this.#security.install(session.defaultSession));
		this.#registerIpc(preferences);
		restoreNativeThemeFromPreferences(preferences);
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

	#registerIpc(preferences: PreferencesStore): void {
		// Boot features registered via FEATURES array (plugin-ready pattern).
		// Each feature persists only under its own storage directory
		// (`${userData}/plugins/<id>` — Decision #20). The returned disposer
		// runs each feature's onDispose callbacks (DB close, etc.) on shutdown.
		this.#disposers.push(bootFeatures(FEATURES, { storageRoot: this.#app.getPath("userData") }));

		const handlers = {
			...createShellHandlers(this.#shell),
			...createThemeHandlers(this.#windows, preferences),
			...createAuthHandlers(this.#auth),
			...createNotificationsHandlers(this.#notifications),
			...createFsHandlers(this.#scopedFs),
			...createFeatureHandlers(),
		} satisfies IpcHandlers;
		this.#ipcServer.register(handlers);
		this.#disposers.push(() => this.#ipcServer.dispose());
	}

	#registerPushEvents(): void {
		this.#disposers.push(
			this.#auth.onChanged((session) => {
				this.#windows.broadcast("auth:changed", session);
			}),
			() => this.#auth.dispose(),
		);
	}

	#dispose(): void {
		if (this.#isShuttingDown) return;
		this.#isShuttingDown = true;
		for (const dispose of this.#disposers.splice(0).reverse()) dispose();
		this.#protocol.dispose();
	}
}
