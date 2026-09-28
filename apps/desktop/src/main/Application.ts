import electronDebug from "electron-debug";
import { shellEnv } from "shell-env";
import { nativeTheme, net, session } from "electron";
import { writeFile } from "node:fs/promises";

import { UPDATE_TRACK_SWITCHER_FLAG, type IpcHandlers } from "@kilo-desktop/contracts";

import { getAppIdentity } from "$config/app-identity.js";
import { resolveWebMcpRendezvous } from "@kilo-desktop/plugin-kilo-server/main";

import {
	bootFeatures,
	createFeatureHandlers,
	createFeatureMessageHandlers,
	createFeaturePortHandlers,
	featureRouter,
} from "./features/registry/feature-registry.js";
import { collectEmbeddedHosts } from "./features/registry/embedded-hosts.js";
import { FEATURES } from "./features/registry/features.js";
import {
	PLUGIN_DEEP_LINKS,
	PLUGIN_PROTOCOLS_BY_FEATURE_ID,
	PLUGIN_PROTOCOL_SCHEMES,
} from "./features/registry/bundled-plugin-manifests.js";
import { registerAuthCapability } from "./features/auth/auth-capability-bridge.js";
import {
	AuthSessionService,
	createKiloIdentityReader,
	type KiloIdentityReader,
} from "./features/auth/auth-service.js";
import { createAuthHandlers } from "./features/auth/handlers.js";
import { createFeatureFlagHandlers, FeatureFlagService } from "./features/feature-flag/index.js";
import { registerFeatureFlagCapability } from "./features/feature-flag/feature-flag-capability-bridge.js";
import { registerPreferencesCapability } from "./platform/preferences-capability-bridge.js";
import { createFsHandlers } from "./features/fs/handlers.js";
import { createNotificationsHandlers } from "./features/notifications/handlers.js";
import { createShellHandlers } from "./features/shell/handlers.js";
import { createTelemetryHandlers, TelemetryService } from "./features/telemetry/index.js";
import {
	createThemeHandlers,
	restoreNativeThemeFromPreferences,
} from "./features/theme/handlers.js";
import { createUpdateHandlers } from "./features/updates/handlers.js";
import { BootProgressReporter } from "./platform/BootProgressReporter.js";
import { AwaitedShutdownBarrier } from "./platform/AwaitedShutdownBarrier.js";
import { DesktopDeepLinkService } from "./platform/DesktopDeepLinkService.js";
import { ElectronApp } from "./platform/ElectronApp.js";
import { ElectronNotifications } from "./platform/ElectronNotifications.js";
import { ElectronProtocol, getDesktopScheme } from "./platform/ElectronProtocol.js";
import { ElectronSecurity } from "./platform/ElectronSecurity.js";
import { ElectronShell } from "./platform/ElectronShell.js";
import { ElectronBrowserHost } from "./platform/ElectronBrowserHost.js";
import { ElectronWindow } from "./platform/ElectronWindow.js";
import { featureFsSandboxDir } from "./platform/featureStorage.js";
import { HttpClient } from "./platform/HttpClient.js";
import { IpcServer } from "./platform/IpcServer.js";
import { createLogger } from "./platform/logger.js";
import { PreferencesStore } from "./platform/PreferencesStore.js";
import { installProxyAgent } from "./platform/proxyAgent.js";
import { ScopedFsService } from "./platform/ScopedFsService.js";
import { SplashWindow } from "./platform/SplashWindow.js";
import { DesktopUpdaterService } from "./platform/Updater.js";
import { flushSentry, identifySentryUser } from "./platform/sentry.js";
import * as Sentry from "@sentry/electron/main";
import { getProductionRendererRoot, getWebDevServerUrl } from "./platform/webDevServer.js";

/**
 * Test-seam identity override, available **only** in binaries built for e2e
 * (`VITE_KILO_E2E_AUTH=1`, baked in by `package:e2e`). When present, the app
 * skips the host Kilo credential store and reports a fixed signed-in identity,
 * clearing the page-level KiloAuthGate without a real device flow. A production
 * binary has no `VITE_KILO_E2E_AUTH`, so this is inert there.
 */
function testAuthIdentity(): KiloIdentityReader | null {
	if (import.meta.env.VITE_KILO_E2E_AUTH !== "1") return null;
	return {
		available: async () => true,
		isAuthenticated: async () => true,
		getIdentity: async () => ({ email: "e2e@kilo.dev" }),
	};
}

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
		// Packaged e2e supplies a test identity (see testAuthIdentity above); the
		// app then skips the host Kilo credential store and reports that identity as
		// signed in, clearing the page-level KiloAuthGate without a real device flow.
		kiloIdentity:
			testAuthIdentity() ??
			createKiloIdentityReader(async () => {
				const cap = featureRouter.capabilityRegistry.get("kilo-server") as {
					connectionService?: {
						getConnection(): Promise<{ baseUrl: string; password: string }>;
					};
				} | null;
				if (!cap?.connectionService) return null;
				try {
					return await cap.connectionService.getConnection();
				} catch {
					return null;
				}
			}, net.fetch.bind(net)),
	});
	#preferences: PreferencesStore | undefined;
	// Restore the source before creating windows; read its persisted palette on every paint.
	readonly #windows = new ElectronWindow(
		this.#shell,
		() => nativeTheme.shouldUseDarkColors,
		() => this.#preferences?.themeId,
		resolveWebMcpRendezvous(this.#app.metadata.isPackaged ? RELEASE_TRACK : "development"),
	);
	readonly #browserHost = new ElectronBrowserHost((webContentsId) =>
		this.#windows.isTrustedWebContents(webContentsId),
	);
	readonly #ipcServer = new IpcServer();
	readonly #logger = createLogger("application");
	readonly #disposers: Array<() => void | Promise<void>> = [];
	readonly #shutdown = new AwaitedShutdownBarrier({
		dispose: () => this.#dispose(),
		quit: () => this.#app.quit(),
		logger: this.#logger,
	});
	#featureFlags: FeatureFlagService | undefined;
	#telemetry: TelemetryService | undefined;
	#updates: DesktopUpdaterService | undefined;
	#deepLinks: DesktopDeepLinkService | undefined;
	#disposePromise: Promise<void> | undefined;

	constructor(preferences?: PreferencesStore) {
		this.#preferences = preferences;
	}

	async start(): Promise<void> {
		this.#logAppSessionStart();
		const identity = getAppIdentity(this.#app.metadata.isPackaged ? RELEASE_TRACK : "development");
		this.#app.setIdentity(identity);
		if (!this.#app.requestSingleInstanceLock()) {
			this.#app.quit();
			return;
		}
		const isDevelopment = !this.#app.metadata.isPackaged;
		const deepLinks = new DesktopDeepLinkService({
			scheme: getDesktopScheme(isDevelopment),
			links: PLUGIN_DEEP_LINKS,
			registerProtocolClient: (scheme) => {
				this.#app.setAsDefaultProtocolClient(scheme);
			},
			onOpenUrl: (listener) =>
				this.#app.on("open-url", (event: { preventDefault(): void }, url: string) => {
					event.preventDefault();
					listener(url);
				}),
			onSecondInstance: (listener) =>
				this.#app.on("second-instance", (_event: unknown, commandLine: string[]) => {
					listener(commandLine);
				}),
			argv: () => process.argv,
			hasWindow: () => this.#windows.main !== undefined,
			reveal: () => this.#windows.reveal(),
			replaceLoadingUrl: (target) => this.#windows.loadMainRoute(target),
			navigate: (target) => this.#windows.navigateMain(target),
		});
		this.#deepLinks = deepLinks;
		this.#disposers.push(() => deepLinks.dispose());
		deepLinks.start();
		const preferences = this.#preferences ?? new PreferencesStore();
		this.#preferences = preferences;
		restoreNativeThemeFromPreferences(preferences);
		this.#logger.debug("Installation id", preferences.getInstallationId());
		identifySentryUser(preferences);

		this.#disposers.push(
			this.#app.on("before-quit", (event: { preventDefault(): void }) => {
				void this.#shutdown.handleBeforeQuit(event);
			}),
		);

		await this.#app.whenReady();
		if (isDevelopment) {
			electronDebug({ showDevTools: false });
		}

		// --- Splash / boot progress ---
		const reporter = new BootProgressReporter();
		const splash = new SplashWindow(reporter, {
			isDark: nativeTheme.shouldUseDarkColors,
			themeId: preferences.themeId,
		});
		splash.show();
		this.#disposers.push(() => reporter.dispose());

		try {
			reporter.report("updates", "Checking for updates\u2026");
			const updates = new DesktopUpdaterService({
				isPackaged: this.#app.metadata.isPackaged,
				platform: process.platform,
				arch: process.arch,
				track: preferences.getReleaseTrack(RELEASE_TRACK),
				currentVersion: this.#app.metadata.appVersion,
				publishUrls: UPDATE_PUBLISH_URLS,
				fetch: this.#http.fetch,
				installWithShutdown: (install) => this.#shutdown.requestExternalQuit(install),
				broadcast: (state) => this.#windows.broadcast("updates:state-changed", state),
				persistTrack: (track) => preferences.setReleaseTrack(track),
				logger: createLogger("updates"),
			});
			this.#updates = updates;
			this.#disposers.push(updates.start());

			reporter.report("initializing", "Configuring protocols\u2026");
			const developmentOrigin = getWebDevServerUrl();
			this.#protocol.register({
				isDevelopment,
				rendererRoot: getProductionRendererRoot(import.meta.dirname),
				...(developmentOrigin ? { developmentOrigin } : {}),
				embeddedHosts: collectEmbeddedHosts,
				pluginSchemes: PLUGIN_PROTOCOL_SCHEMES,
			});

			// Bootstrap networking before #registerIpc (bootFeatures). In packaged
			// builds, merge the login-shell env into process.env so GUI-launched
			// builds see env-var proxies and the correct PATH (`shell-env`
			// no-ops on Windows; dev inherits the terminal env via `pnpm dev`).
			// Non-fatal by design: a failure degrades to the inherited env
			// (no login-shell PATH / proxy vars) but does not abort boot.
			if (!isDevelopment) {
				try {
					Object.assign(process.env, await shellEnv());
				} catch (error) {
					this.#logger.warn("login-shell env sync failed; continuing with inherited env", error);
				}
			}
			installProxyAgent();

			this.#disposers.push(
				this.#security.install(session.defaultSession, { embeddedHosts: collectEmbeddedHosts }),
			);

			reporter.report("features", "Preparing features\u2026");
			Sentry.addBreadcrumb({ category: "app.boot", message: "Booting features" });
			await this.#registerIpc(preferences, isDevelopment, reporter);
			Sentry.addBreadcrumb({ category: "app.boot", message: "Features booted" });
			this.#registerPushEvents();

			// Fire the bootstrap event after IPC is registered. Fire-and-forget: the
			// service swallows its own errors, so telemetry never blocks startup.
			void this.#telemetry?.initialize();
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
		const initialRoute = deepLinks.takeInitialRoute();
		this.#windows.create({
			isDevelopment,
			deferShow: true,
			...(initialRoute ? { initialRoute } : {}),
		});
		await Promise.all([splash.close(), this.#windows.whenReady()]);
		this.#windows.reveal();
		deepLinks.markWindowReady();
		await this.#signalReleaseSmokeReady();

		this.#disposers.push(
			this.#app.on("activate", () => {
				if (!this.#windows.main) this.#createWindow(isDevelopment);
				else this.#windows.reveal();
			}),
			this.#app.on("window-all-closed", () => {
				this.#deepLinks?.markWindowClosed();
				if (process.platform !== "darwin") this.#app.quit();
			}),
		);
	}

	async #signalReleaseSmokeReady(): Promise<void> {
		if (process.env.CI !== "true") return;
		const readyFile = process.env.KILO_RELEASE_SMOKE_READY_FILE;
		if (readyFile) await writeFile(readyFile, "ready\n", { flag: "wx" });
	}

	#createWindow(isDevelopment: boolean): void {
		const initialRoute = this.#deepLinks?.takeInitialRoute();
		this.#windows.create({
			isDevelopment,
			...(initialRoute ? { initialRoute } : {}),
		});
		void this.#windows.whenReady().then(() => this.#deepLinks?.markWindowReady());
	}

	// Marks the start of a new application session in the main log with a version/platform/pid
	// banner, making session boundaries and build/OS context easy to spot when
	// scanning or grepping a log file.
	#logAppSessionStart(): void {
		const { appVersion, isPackaged } = this.#app.metadata;
		const divider = "=".repeat(100);
		this.#logger.info(
			`New application session started\n${divider}\n` +
				`version=${appVersion} | packaged=${isPackaged} | platform=${process.platform} | arch=${process.arch} | pid=${process.pid}\n` +
				divider,
		);
	}

	/**
	 * Expose main-side plugin capabilities (`mainSdk.plugins.get(...)`).
	 * Must run before `bootFeatures` — see the call site in `#registerIpc`.
	 * Returns the created feature-flag service and the registration disposers.
	 */
	#registerCapabilities(preferences: PreferencesStore): {
		featureFlags: FeatureFlagService;
		disposers: Array<() => void>;
	} {
		const featureFlags = FeatureFlagService.create({
			auth: this.#auth,
			appVersion: this.#app.metadata.appVersion,
			storageRoot: this.#app.getPath("userData"),
		});

		const telemetryEnv = this.#app.metadata.isPackaged ? RELEASE_TRACK : "development";

		return {
			featureFlags,
			disposers: [
				// The auth service's getApiKey, resolved via plugins.get("auth").
				registerAuthCapability(this.#auth),
				// The feature-flag service so features/plugins can gate behavior
				// on flags. Flag changes are relayed to the feature event bus as
				// `feature-flag.changed`.
				registerFeatureFlagCapability(featureFlags),
				// User data-collection preference and telemetry environment so
				// plugins can gate subprocess telemetry (e.g. bridge sidecar).
				registerPreferencesCapability(preferences, telemetryEnv),
			],
		};
	}

	async #registerIpc(
		preferences: PreferencesStore,
		isDevelopment: boolean,
		reporter?: BootProgressReporter,
	): Promise<void> {
		// Expose main-side plugin capabilities BEFORE booting features:
		// `bootFeatures` synchronously invokes every feature's `mainRegister`,
		// and a feature is allowed to resolve capabilities synchronously
		// during its own boot. Registering afterwards would silently hand
		// such a feature "unavailable" (flagged twice in PR #116 review).
		const { featureFlags, disposers: capabilityDisposers } =
			this.#registerCapabilities(preferences);
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
				// Each plugin may handle URL schemes it declared in its
				// manifest's `protocols` array; undeclared schemes are
				// rejected. `bootFeatures` runs after app-ready, so
				// `protocol.handle` is legal here; the declared schemes
				// themselves were registered pre-ready by
				// registerDesktopSchemes from the same manifests.
				createProtocolDelegate: (featureId: string) => ({
					handle: (scheme, handler) => {
						if (!PLUGIN_PROTOCOLS_BY_FEATURE_ID.get(featureId)?.includes(scheme)) {
							throw new Error(
								`Feature "${featureId}" cannot handle scheme "${scheme}": not declared in its manifest's "protocols" array.`,
							);
						}
						this.#protocol.registerFeatureScheme(scheme, handler);
					},
				}),
				createHost: (featureId) => ({
					paths: {
						defaultSaveDirectory: () => this.#app.getPath("documents"),
						tempDirectory: () => this.#app.getPath("temp"),
					},
					dialog: {
						openFile: (senderId, options) => this.#shell.showOpenFileDialog(senderId, options),
						saveFile: (senderId, options) => this.#shell.showSaveFileDialog(senderId, options),
					},
					externalLinks: {
						open: (url) => this.#shell.openExternal(url),
					},
					window: {
						getTitle: (senderId) => this.#windows.getTitle(senderId),
						setTitle: (senderId, title) => this.#windows.setTitle(senderId, title),
						isFocused: (senderId) => this.#windows.isFocused(senderId),
						onFocusChange: (senderId, listener) => this.#windows.onFocusChange(senderId, listener),
					},
					...(featureId === "browser" ? { browser: this.#browserHost } : {}),
				}),
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
		// Registered after the boot disposer, so reverse-order teardown unbinds
		// every claimed plugin scheme before the features' own cleanup runs.
		this.#disposers.push(() => this.#protocol.unregisterAllFeatureSchemes());

		const telemetry = TelemetryService.create({
			auth: this.#auth,
			preferences,
			appVersion: this.#app.metadata.appVersion,
			environment: this.#app.metadata.isPackaged ? RELEASE_TRACK : "development",
		});
		this.#telemetry = telemetry;
		this.#disposers.push(() => void telemetry.dispose());

		const handlers = {
			...createShellHandlers(this.#shell, this.#windows, isDevelopment),
			...createThemeHandlers(this.#windows, preferences),
			...createAuthHandlers(this.#auth),
			...createNotificationsHandlers(this.#notifications),
			...createFsHandlers(this.#scopedFs),
			...createTelemetryHandlers(telemetry),
			...createFeatureHandlers(),
			...createFeatureFlagHandlers(featureFlags),
			...createUpdateHandlers(this.#updates!, {
				isTrackSwitchingEnabled: () =>
					featureFlags.getFlag<boolean>(UPDATE_TRACK_SWITCHER_FLAG, false),
			}),
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

	#dispose(): Promise<void> {
		this.#disposePromise ??= this.#disposeOnce();
		return this.#disposePromise;
	}

	async #disposeOnce(): Promise<void> {
		for (const dispose of this.#disposers.splice(0).reverse()) {
			try {
				await dispose();
			} catch (error) {
				this.#logger.error("shutdown disposer failed", error);
			}
		}
		try {
			this.#protocol.dispose();
		} catch (error) {
			this.#logger.error("protocol shutdown failed", error);
		}
		await flushSentry();
	}
}
