import electronDebug from "electron-debug";
// import { shellEnv } from "shell-env";
import { nativeTheme, session } from "electron";

import type { IpcHandlers } from "@anaconda-agentic-desktop/contracts";

import { getAppIdentity } from "$config/app-identity.js";

import {
	bootFeatures,
	createFeatureHandlers,
	createFeatureMessageHandlers,
	createFeaturePortHandlers,
} from "./features/registry/feature-registry.js";
import { FEATURES } from "./features/registry/features.js";
import { registerAuthCapability } from "./features/auth/auth-capability-bridge.js";
import { AuthSessionService } from "./features/auth/auth-service.js";
import { createAuthHandlers } from "./features/auth/handlers.js";
import { createFeatureFlagHandlers, FeatureFlagService } from "./features/feature-flag/index.js";
import { registerFeatureFlagCapability } from "./features/feature-flag/feature-flag-capability-bridge.js";
import { createFsHandlers } from "./features/fs/handlers.js";
import { createNotificationsHandlers } from "./features/notifications/handlers.js";
import { createShellHandlers } from "./features/shell/handlers.js";
import {
	createThemeHandlers,
	restoreNativeThemeFromPreferences,
} from "./features/theme/handlers.js";
import { BootProgressReporter } from "./platform/BootProgressReporter.js";
import { ElectronApp } from "./platform/ElectronApp.js";
import { ElectronNotifications } from "./platform/ElectronNotifications.js";
import { ElectronProtocol } from "./platform/ElectronProtocol.js";
import { ElectronSecurity } from "./platform/ElectronSecurity.js";
import { ElectronShell } from "./platform/ElectronShell.js";
import { ElectronWindow } from "./platform/ElectronWindow.js";
import { featureFsSandboxDir } from "./platform/featureStorage.js";
import { HttpClient } from "./platform/HttpClient.js";
import { IpcServer } from "./platform/IpcServer.js";
import { createLogger } from "./platform/logger.js";
import { PreferencesStore } from "./platform/PreferencesStore.js";
import { installProxyAgent } from "./platform/proxyAgent.js";
import { ScopedFsService } from "./platform/ScopedFsService.js";
import { SplashWindow } from "./platform/SplashWindow.js";
import { configureUpdater } from "./platform/Updater.js";
import { flushSentry } from "./platform/sentry.js";
import * as Sentry from "@sentry/electron/main";
import { getProductionRendererRoot, getWebDevServerUrl } from "./platform/webDevServer.js";

export class Application {
	readonly #app = new ElectronApp();
	readonly #protocol = new ElectronProtocol();
	readonly #security = new ElectronSecurity();
	readonly #shell = new ElectronShell();
	readonly #notifications = new ElectronNotifications();
	readonly #http = new HttpClient();
	// sdk.fs sandbox — a dedicated `fs/` subdir of the feature's Decision #20
	// storage dir, kept a SIBLING of its SQLite data.db so no fs call can reach
	// the database (see featureStorage.ts).
	readonly #scopedFs = new ScopedFsService((featureId) =>
		featureFsSandboxDir(this.#app.getPath("userData"), featureId),
	);
	readonly #auth = new AuthSessionService({
		userAgent: `anaconda-agentic-desktop/${this.#app.metadata.appVersion}`,
	});
	// After restoreNativeThemeFromPreferences, nativeTheme is the chrome signal.
	readonly #windows = new ElectronWindow(this.#shell, () => nativeTheme.shouldUseDarkColors);
	readonly #ipcServer = new IpcServer();
	readonly #disposers: Array<() => void> = [];
	#featureFlags: FeatureFlagService | undefined;
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
			this.#app.on("before-quit", () => void flushSentry()),
			this.#app.on("before-quit", () => this.#dispose()),
		);

		await this.#app.whenReady();
		const isDevelopment = !this.#app.metadata.isPackaged;
		if (isDevelopment) {
			electronDebug({ showDevTools: false });
		}

		// --- Splash / boot progress ---
		const reporter = new BootProgressReporter();
		const splash = new SplashWindow(reporter, {
			isDark: nativeTheme.shouldUseDarkColors,
		});
		splash.show();
		this.#disposers.push(() => reporter.dispose());

		try {
			reporter.report("updates", "Checking for updates\u2026");
			this.#disposers.push(configureUpdater());

			reporter.report("initializing", "Configuring protocols\u2026");
			const developmentOrigin = getWebDevServerUrl();
			this.#protocol.register({
				isDevelopment,
				rendererRoot: getProductionRendererRoot(import.meta.dirname),
				...(developmentOrigin ? { developmentOrigin } : {}),
			});

			// Bootstrap networking before #registerIpc (bootFeatures): merge the
			// login-shell env into process.env so GUI-launched builds see env-var
			// proxies (`shell-env` no-ops on Windows), then patch in-process
			// http/https/fetch so third-party deps honor corporate/system proxies.
			// Object.assign(process.env, await shellEnv());
			installProxyAgent();

			this.#disposers.push(this.#security.install(session.defaultSession));

			reporter.report("features", "Preparing features\u2026");
			Sentry.addBreadcrumb({ category: "app.boot", message: "Booting features" });
			await this.#registerIpc(preferences, reporter);
			Sentry.addBreadcrumb({ category: "app.boot", message: "Features booted" });
			this.#registerPushEvents();
			restoreNativeThemeFromPreferences(preferences);
		} catch (error) {
			// Boot failed — close the splash and quit. Do not reveal a
			// half-initialized main window without security/IPC/handlers.
			Sentry.captureException(error, { tags: { phase: "boot" } });
			reporter.complete();
			await splash.close();
			this.#app.quit();
			throw error;
		}

		reporter.complete();

		// Create the main window concurrently with closing the splash
		// so there's no dead gap between the two.
		this.#windows.create({ isDevelopment, deferShow: true });
		await Promise.all([splash.close(), this.#windows.whenReady()]);
		this.#windows.reveal();

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

	/**
	 * Expose main-side plugin capabilities (`mainSdk.plugins.get(...)`).
	 * Must run before `bootFeatures` — see the call site in `#registerIpc`.
	 * Returns the created feature-flag service and the registration disposers.
	 */
	#registerCapabilities(): { featureFlags: FeatureFlagService; disposers: Array<() => void> } {
		const featureFlags = FeatureFlagService.create({
			auth: this.#auth,
			appVersion: this.#app.metadata.appVersion,
		});

		return {
			featureFlags,
			disposers: [
				// The auth service's getApiKey, resolved via plugins.get("auth").
				registerAuthCapability(this.#auth),
				// The feature-flag service so features/plugins can gate behavior
				// on flags. Flag changes are relayed to the feature event bus as
				// `feature-flag.changed`.
				registerFeatureFlagCapability(featureFlags),
			],
		};
	}

	async #registerIpc(
		preferences: PreferencesStore,
		reporter?: BootProgressReporter,
	): Promise<void> {
		// Expose main-side plugin capabilities BEFORE booting features:
		// `bootFeatures` synchronously invokes every feature's `mainRegister`,
		// and a feature is allowed to resolve capabilities synchronously
		// during its own boot. Registering afterwards would silently hand
		// such a feature "unavailable" (flagged twice in PR #116 review).
		const { featureFlags, disposers: capabilityDisposers } = this.#registerCapabilities();
		this.#featureFlags = featureFlags;
		this.#disposers.push(...capabilityDisposers);

		// Seed the feature-flag provider BEFORE `bootFeatures` so a feature
		// that gates its `mainRegister` on a flag reads the actual
		// LaunchDarkly value at boot, not the pre-init default. `initialize()`
		// awaits `client.start({ timeout: 5s })` — capped at 5s worst case
		// when LD is unreachable, and typically <500ms — and swallows its
		// own errors so it never fails the boot. Features that also need to
		// react to *runtime* toggles still subscribe to `feature-flag.changed`
		// (see anaconda-mcp for the reconcile pattern).
		await featureFlags.initialize();

		// Boot features registered via FEATURES array (plugin-ready pattern).
		// Each feature persists only under its own storage directory
		// (`${userData}/plugins/<id>` — Decision #20). The returned disposer
		// runs each feature's onDispose callbacks (DB close, etc.) on shutdown.
		this.#disposers.push(
			await bootFeatures(FEATURES, {
				storageRoot: this.#app.getPath("userData"),
				emitEvent: (event) => this.#windows.broadcast("feature:event", event),
				createLogger,
				fetch: this.#http.fetch,
				...(reporter
					? {
							// Coarse "Preparing <id>…" line the shell writes once
							// before each feature's mainRegister runs.
							onBeforeFeatureBoot: (featureId: string) => reporter.reportFeature(featureId),
							// Fine-grained line features push from inside mainRegister
							// via mainSdk.boot.reportProgress (e.g. "Staging Miniconda…").
							// The reporter preserves the feature id in the log while
							// keeping the user-facing splash message clean.
							onFeatureProgress: (featureId: string, message: string) =>
								reporter.reportFeatureProgress(featureId, message),
						}
					: {}),
			}),
		);

		const handlers = {
			...createShellHandlers(this.#shell),
			...createThemeHandlers(this.#windows, preferences),
			...createAuthHandlers(this.#auth),
			...createNotificationsHandlers(this.#notifications),
			...createFsHandlers(this.#scopedFs),
			...createFeatureHandlers(),
			...createFeatureFlagHandlers(featureFlags),
		} satisfies IpcHandlers;
		this.#ipcServer.register(
			handlers,
			createFeatureMessageHandlers((event, senderId) =>
				this.#windows.broadcast("feature:event", event, senderId),
			),
			createFeaturePortHandlers(),
		);
		this.#disposers.push(() => this.#ipcServer.dispose());
		this.#disposers.push(() => this.#featureFlags?.dispose());
	}

	#registerPushEvents(): void {
		this.#disposers.push(
			this.#auth.onChanged((session) => {
				this.#windows.broadcast("auth:changed", session);
			}),
			() => this.#auth.dispose(),
		);
		this.#featureFlags?.on("change", (flags) => {
			this.#windows.broadcast("feature-flag:changed", flags);
		});
	}

	#dispose(): void {
		if (this.#isShuttingDown) return;
		this.#isShuttingDown = true;
		for (const dispose of this.#disposers.splice(0).reverse()) dispose();
		this.#protocol.dispose();
	}
}
