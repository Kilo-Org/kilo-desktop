import path from "node:path";

import electronDebug from "electron-debug";
import { shellEnv } from "shell-env";
import {
	app,
	BrowserWindow,
	dialog,
	Menu,
	nativeTheme,
	net,
	powerMonitor,
	session,
} from "electron";

import { protocolSchemes, BUNDLED_PLUGINS } from "@kilo-desktop/bundled-plugins";
import {
	KernelCommand,
	KernelError,
	KernelKeybindings,
	resolveKeybindings,
	type AppMenuNode,
	type EmbeddedHostRegistration,
	type KernelLogger,
	type KeyboardPlatform,
} from "@kilo-desktop/kernel";
import {
	createMainKernel,
	type MainKernel,
	type WindowOpenRequest,
} from "@kilo-desktop/kernel/main";

import { getAppIdentity } from "$config/app-identity.js";
import { requestDevRelaunch } from "$config/dev-relaunch.js";
import { readLinuxPackageFormat } from "$config/linux-package.js";

import {
	repaintOnSystemColorSchemeChange,
	restoreNativeThemeFromPreferences,
} from "../platform/native-theme.js";
import { ElectronApp } from "../platform/ElectronApp.js";
import { buildFallbackMenuTemplate } from "../platform/ElectronAppMenu.js";
import { ElectronBrowserHost } from "../platform/ElectronBrowserHost.js";
import type { EmbeddedWebHost } from "../platform/embedded-web-host.js";
import { ElectronNotifications } from "../platform/ElectronNotifications.js";
import {
	ElectronProtocol,
	getDesktopOrigin,
	getDesktopScheme,
} from "../platform/ElectronProtocol.js";
import { configureTrustedSchemes, ElectronSecurity } from "../platform/ElectronSecurity.js";
import { ElectronShell } from "../platform/ElectronShell.js";
import { ElectronShortcuts } from "../platform/ElectronShortcuts.js";
import { ElectronWindow } from "../platform/ElectronWindow.js";
import { createFeatureKvStoreFactory } from "../platform/featureKvStore.js";
import { featureFsSandboxDir, featureStorageDir } from "../platform/featureStorage.js";
import { HttpClient } from "../platform/HttpClient.js";
import { createLogger, getLogFilePath } from "../platform/logger.js";
import type { PreferencesStore } from "../platform/PreferencesStore.js";
import { installProxyAgent } from "../platform/proxyAgent.js";
import { signalReleaseSmokeReady } from "../platform/release-smoke.js";
import { ScopedFsService } from "../platform/ScopedFsService.js";
import { identifySentryUser } from "../platform/sentry.js";
import { DesktopUpdaterService } from "../platform/Updater.js";
import { getProductionRendererRoot, getWebDevServerUrl } from "../platform/webDevServer.js";
import { WindowsUpdateFeed } from "../platform/WindowsUpdateFeed.js";
import { windowArguments } from "../../preload/window-arguments.js";
import { buildMenuTemplate, WindowMenus, type MenuCommands } from "./app-menu.js";
import { ElectronKernelTransport } from "./ElectronKernelTransport.js";
import { parseFlagOverrides } from "./flag-overrides.js";
import { provideHostPrimitives, type NativeChrome } from "./host-primitives.js";
import { createHostServices } from "./host-services.js";
import { bundledPluginRoot, bundledWebPluginIds, mainRegistrations } from "./plugins.js";

const SAFE_MODE_SWITCH = "--safe-mode";
const KEYCHAIN_SERVICE = "Kilo Desktop Plugins";
const KEYBOARD_SYNC_CHANNEL = "kernel:keyboard-sync";
const ONLINE_POLL_MS = 30_000;

/** Loaded on first use: keytar is a native module and should not delay boot. */
const loadKeytar = () => import("@github/keytar").then((module) => module.default);

function keyboardPlatform(): KeyboardPlatform {
	if (process.platform === "darwin") return "mac";
	if (process.platform === "win32") return "windows";
	return "linux";
}

function kernelLogger(): KernelLogger {
	const log = createLogger("kernel");
	return {
		debug: (message, ...details) => log.debug(message, ...details),
		info: (message, ...details) => log.info(message, ...details),
		warn: (message, ...details) => log.warn(message, ...details),
		error: (message, ...details) => log.error(message, ...details),
	};
}

/**
 * Boots the kernel: Electron lifecycle, security, protocols, the kernel
 * transport, host primitives and services, then plugins. It knows nothing
 * about the product; everything visible comes from plugins (or the kernel's
 * recovery screen when there are none).
 */
/** How long the login shell may take to report its environment (VS Code allows the same). */
const LOGIN_ENVIRONMENT_TIMEOUT_MS = 10_000;

export class KernelApplication {
	readonly #app = new ElectronApp();
	readonly #logger = createLogger("app");
	readonly #shell = new ElectronShell();
	readonly #kernelStore = createFeatureKvStoreFactory(path.join(app.getPath("userData"), "kernel"));
	readonly #chromeStore = this.#kernelStore({
		defaults: { chrome: null as NativeChrome | null },
		namespace: "native-theme",
	});
	readonly #windows = new ElectronWindow(
		this.#shell,
		() => nativeTheme.shouldUseDarkColors,
		() => this.#chromeStore.get("chrome") ?? undefined,
		() => [...this.#embeddedHosts.values()],
	);
	readonly #protocol = new ElectronProtocol();
	readonly #security = new ElectronSecurity();
	readonly #shortcuts = new ElectronShortcuts();
	readonly #http = new HttpClient();
	readonly #transport = new ElectronKernelTransport(undefined, (error) =>
		this.#logger.error("Kernel request failed", error),
	);
	readonly #embeddedHosts = new Map<string, EmbeddedWebHost>();
	readonly #storageRoot = app.getPath("userData");
	readonly #disposers: (() => void)[] = [];
	readonly #updaterListeners = new Set<(state: unknown) => void>();
	readonly #menus = new WindowMenus({
		render: (windowId, menus) =>
			buildMenuTemplate(menus, this.#menuCommands(windowId), keyboardPlatform()),
		fallback: () => buildFallbackMenuTemplate(),
		show: (template) => Menu.setApplicationMenu(Menu.buildFromTemplate(template)),
	});
	#kernel: MainKernel | undefined;
	#isDevelopment = false;
	#quitting = false;
	/** Settles once the login shell's environment is in `process.env` (see `start`). */
	#loginEnvironment: Promise<void> = Promise.resolve();
	#windowSequence = 0;

	constructor(private readonly preferences: PreferencesStore) {}

	/** Logs a startup milestone with the time since the process started. */
	#mark(milestone: string): void {
		this.#logger.info(`Startup: ${milestone} at ${Math.round(performance.now())} ms.`);
	}

	/**
	 * Reads the login shell's environment into `process.env`, giving up after
	 * `LOGIN_ENVIRONMENT_TIMEOUT_MS`: the shell runs the person's startup
	 * files, and one that hangs must not hold the app back. A late reply is
	 * dropped, so the environment never changes under processes already
	 * spawned.
	 */
	async #syncLoginEnvironment(): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), LOGIN_ENVIRONMENT_TIMEOUT_MS);
		});
		try {
			const environment = await Promise.race([shellEnv(), timeout]);
			if (environment === "timeout") {
				this.#logger.warn(
					`login-shell env took over ${LOGIN_ENVIRONMENT_TIMEOUT_MS} ms; continuing with inherited env`,
				);
				return;
			}
			Object.assign(process.env, environment);
		} catch (error) {
			this.#logger.warn("login-shell env sync failed; continuing with inherited env", error);
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Marks the start of a new application session in the main log with a
	 * version/platform/pid banner, so session boundaries and build/OS context
	 * are easy to spot when scanning or grepping a log file.
	 */
	#logAppSessionStart(): void {
		const { appVersion, isPackaged } = this.#app.metadata;
		const divider = "=".repeat(100);
		this.#logger.info(
			`New application session started\n${divider}\n` +
				`version=${appVersion} | packaged=${isPackaged} | track=${RELEASE_TRACK} | platform=${process.platform} | arch=${process.arch} | pid=${process.pid}\n` +
				divider,
		);
	}

	async start(): Promise<void> {
		this.#logAppSessionStart();
		const identity = getAppIdentity(this.#app.metadata.isPackaged ? RELEASE_TRACK : "development");
		this.#app.setIdentity(identity);
		if (!this.#app.requestSingleInstanceLock()) {
			this.#app.quit();
			return;
		}
		this.#isDevelopment = !this.#app.metadata.isPackaged;
		configureTrustedSchemes(this.#isDevelopment);
		restoreNativeThemeFromPreferences(this.preferences);
		identifySentryUser(this.preferences);
		// The login shell's environment (PATH, proxies, tool homes) takes
		// seconds to read. It runs while plugins activate and the window
		// loads, and is in place before anything spawns a tool.
		const loginEnvironment = this.#isDevelopment ? Promise.resolve() : this.#syncLoginEnvironment();
		this.#loginEnvironment = loginEnvironment;

		const kernel = this.#createKernel(identity.squirrelName);
		this.#kernel = kernel;
		this.#watchAppUrls(kernel);
		this.#disposers.push(
			this.#app.on("before-quit", (event: { preventDefault(): void }) => this.#onBeforeQuit(event)),
		);

		await this.#app.whenReady();
		this.#menus.refresh();
		this.#disposers.push(
			this.#shortcuts.install(),
			repaintOnSystemColorSchemeChange(this.#windows),
		);
		if (this.#isDevelopment) electronDebug({ showDevTools: false });

		const developmentOrigin = getWebDevServerUrl();
		const pluginSchemes = protocolSchemes(BUNDLED_PLUGINS);
		this.#protocol.register({
			isDevelopment: this.#isDevelopment,
			rendererRoot: getProductionRendererRoot(path.join(import.meta.dirname)),
			...(developmentOrigin ? { developmentOrigin } : {}),
			embeddedHosts: () => [...this.#embeddedHosts.values()],
			pluginSchemes,
		});
		installProxyAgent();
		this.#disposers.push(
			this.#security.install(session.defaultSession, {
				embeddedHosts: () => [...this.#embeddedHosts.values()],
			}),
			this.#transport.install(),
			this.#transport.on(KEYBOARD_SYNC_CHANNEL, (payload, from) =>
				this.#syncShortcuts(payload, from),
			),
		);

		this.#mark("app ready");
		// The window opens as soon as plugins are active; the login shell's
		// environment arrives meanwhile. Everything that spawns tools waits for
		// it: services (the kernel holds them), and plugin code that resolves or
		// spawns a tool on request (`environmentReady(sdk)`).
		await kernel.start({ environmentReady: loginEnvironment });
		this.#mark("plugins activated");
		void loginEnvironment.then(() => this.#mark("login environment ready"));
		this.#watchSystem(kernel);
		this.#watchMenuCommands(kernel);
		this.#openMainWindow(kernel);
		await this.#windows.whenReady();
		this.#windows.reveal();
		this.#mark("window shown");
		void kernel.windowShown();
		await signalReleaseSmokeReady(process.env);

		this.#disposers.push(
			this.#app.on("activate", () => {
				if (!this.#windows.main) this.#openMainWindow(kernel);
				else this.#windows.reveal();
			}),
			this.#app.on("window-all-closed", () => {
				if (process.platform !== "darwin") this.#app.quit();
			}),
		);
	}

	#createKernel(squirrelName: string): MainKernel {
		const updates = this.#createUpdater(squirrelName);
		const keybindingsStore = this.#kernelStore({
			defaults: { overrides: {} as Record<string, string | null> },
			namespace: "keybindings",
		});
		const pluginsStore = this.#kernelStore({
			defaults: { disabled: [] as string[] },
			namespace: "plugins",
		});
		const fs = new ScopedFsService((pluginId) => featureFsSandboxDir(this.#storageRoot, pluginId));
		const browser = new ElectronBrowserHost(
			(webContentsId) => this.#windows.isTrustedWebContents(webContentsId),
			this.#shell,
		);

		const kernel = createMainKernel({
			registrations: mainRegistrations(),
			webPlugins: bundledWebPluginIds(),
			transport: this.#transport,
			logger: kernelLogger(),
			host: {
				platform: keyboardPlatform(),
				version: this.#app.metadata.appVersion,
				rendererOrigins: [getDesktopOrigin(this.#isDevelopment)],
				safeMode: process.argv.includes(SAFE_MODE_SWITCH),
				flagOverrides: parseFlagOverrides(import.meta.env.VITE_FEATURE_FLAG_OVERRIDES),
				initialSystem: {
					appearance: nativeTheme.shouldUseDarkColors ? "dark" : "light",
					online: net.isOnline(),
				},
				confirm: (kind, reasons) => this.#confirm(kind, reasons),
				quit: () => this.#app.quit(),
				relaunch: ({ safeMode }) => void this.#relaunch(safeMode),
				windows: {
					open: (request) => this.#openSecondaryWindow(request),
					focus: (windowId) => {
						const contents = this.#transport.contentsOf(windowId);
						const window = contents && BrowserWindow.fromWebContents(contents);
						if (window) this.#windows.reveal(window);
					},
					close: (windowId) => {
						const contents = this.#transport.contentsOf(windowId);
						BrowserWindow.fromWebContents(contents!)?.close();
					},
					setHidden: (windowId, hidden) => {
						const contents = this.#transport.contentsOf(windowId);
						const window = contents && BrowserWindow.fromWebContents(contents);
						if (!window) return;
						if (hidden) window.hide();
						else window.showInactive();
					},
					focusMain: () => this.#windows.reveal(),
				},
				keybindings: {
					load: () => keybindingsStore.get("overrides"),
					save: (overrides) => void keybindingsStore.set({ overrides: { ...overrides } }),
				},
				plugins: {
					loadDisabled: () => {
						const disabled: unknown = pluginsStore.get("disabled");
						return Array.isArray(disabled) ? disabled.filter((id) => typeof id === "string") : [];
					},
					saveDisabled: (disabled) => void pluginsStore.set({ disabled: [...disabled] }),
				},
			},
			hostServices: (pluginId, manifest) =>
				createHostServices(
					{
						storageDir: (id) => featureStorageDir(this.#storageRoot, id),
						kv: (dir) => createFeatureKvStoreFactory(dir),
						fs,
						fetch: this.#http.fetch,
						environmentReady: this.#loginEnvironment,
						protocol: {
							register: (scheme, handler) =>
								this.#protocol.registerFeatureScheme(scheme, async (request) => handler(request)),
							unregister: (scheme) => this.#protocol.unregisterFeatureScheme(scheme),
						},
						embeddedHosts: {
							register: (registration: EmbeddedHostRegistration) => {
								this.#embeddedHosts.set(registration.host, registration as EmbeddedWebHost);
								return () => this.#embeddedHosts.delete(registration.host);
							},
						},
						browser,
						assets: this.#app.metadata.isPackaged
							? { packagedResourcesPath: process.resourcesPath, pluginRoot: () => undefined }
							: { pluginRoot: bundledPluginRoot },
					},
					pluginId,
					manifest,
				),
		});

		const notifications = new ElectronNotifications();
		provideHostPrimitives(kernel.kernelSdk, {
			focusedWindow: () => BrowserWindow.getFocusedWindow() ?? this.#windows.main,
			dialog: {
				showOpenDialog: (window, options) =>
					window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options),
				showSaveDialog: (window, options) =>
					window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options),
				showMessageBox: (window, options) =>
					window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options),
			},
			clipboard: { writeText: (text) => this.#shell.copyText(text) },
			os: {
				openExternal: (url) => this.#shell.openExternal(url),
				showItemInFolder: (filePath) => this.#shell.showItemInFolder(filePath),
				showLogs: () => this.#shell.showItemInFolder(getLogFilePath()),
				logFilePath: () => getLogFilePath(),
			},
			notifications: {
				show: (input) => notifications.show({ ...input, type: "info" }),
				setBadge: (count) => notifications.setBadge(count),
			},
			dataCollection: {
				choice: () => this.preferences.dataCollectionChoice,
				allowed: () => this.preferences.allowDataCollection,
				installationId: () => this.preferences.getInstallationId(),
				environment: this.#app.metadata.isPackaged ? RELEASE_TRACK : "development",
				setChoice: (allow) => this.preferences.setAllowDataCollection(allow),
				onChange: (listener) => this.preferences.onDidChangeAllowDataCollection(listener),
			},
			keychain: {
				get: async (account) => (await loadKeytar()).getPassword(KEYCHAIN_SERVICE, account),
				set: async (account, value) =>
					(await loadKeytar()).setPassword(KEYCHAIN_SERVICE, account, value),
				delete: async (account) =>
					void (await (await loadKeytar()).deletePassword(KEYCHAIN_SERVICE, account)),
			},
			appMenu: (windowId: string, menus: readonly AppMenuNode[]) =>
				this.#menus.set(windowId, menus),
			nativeTheme: {
				source: nativeTheme.themeSource,
				shouldUseDarkColors: () => nativeTheme.shouldUseDarkColors,
				onUpdated: (listener) => {
					nativeTheme.on("updated", listener);
					return () => nativeTheme.off("updated", listener);
				},
				setSource: (source) => {
					nativeTheme.themeSource = source;
					this.preferences.setThemeSource(source);
					this.#windows.applyColorScheme();
				},
				setChrome: (chrome) => {
					this.#chromeStore.set({ chrome });
					this.#windows.applyColorScheme();
				},
			},
			updater: {
				get state() {
					return updates.state;
				},
				onChange: (listener) => {
					this.#updaterListeners.add(listener);
					return () => this.#updaterListeners.delete(listener);
				},
				check: () => updates.check(),
				install: () => updates.install(),
				setTrack: (track) => {
					if (track !== "preview" && track !== "stable") {
						throw new KernelError("VALIDATION", `Unknown release track "${track}".`);
					}
					return updates.setTrack(track);
				},
			},
		});
		return kernel;
	}

	#createUpdater(squirrelName: string): DesktopUpdaterService {
		const updates = new DesktopUpdaterService({
			isPackaged: this.#app.metadata.isPackaged,
			platform: process.platform,
			arch: process.arch,
			track: this.preferences.getReleaseTrack(RELEASE_TRACK),
			installedTrack: RELEASE_TRACK,
			currentVersion: this.#app.metadata.appVersion,
			publishUrls: UPDATE_PUBLISH_URLS,
			fetch: this.#http.fetch,
			installWithShutdown: (install) => {
				this.#quitting = true;
				void this.#kernel?.stop().finally(install);
			},
			broadcast: (state) => {
				for (const listener of [...this.#updaterListeners]) listener(state);
			},
			persistTrack: (track) => this.preferences.setReleaseTrack(track),
			logger: createLogger("updates"),
			...(process.platform === "linux" &&
				this.#app.metadata.isPackaged && {
					linuxPackageFormat: readLinuxPackageFormat(process.resourcesPath),
				}),
			...(process.platform === "win32" && {
				windowsFeed: new WindowsUpdateFeed({
					directory: path.join(this.#storageRoot, "squirrel-feed"),
					packageName: squirrelName,
					fetch: this.#http.fetch,
				}),
			}),
		});
		this.#disposers.push(updates.start());
		return updates;
	}

	#openMainWindow(kernel: MainKernel): void {
		const window = this.#windows.create({
			isDevelopment: this.#isDevelopment,
			deferShow: true,
			options: {
				webPreferences: {
					additionalArguments: windowArguments({ id: "main", role: "main", params: {} }),
				},
			},
		});
		this.#trackWindow(kernel, "main", window, { role: "main" });
	}

	async #openSecondaryWindow(request: WindowOpenRequest): Promise<string> {
		const kernel = this.#kernel!;
		this.#windowSequence += 1;
		const windowId = `w${this.#windowSequence}`;
		const window = this.#windows.openSecondary({
			isDevelopment: this.#isDevelopment,
			title: request.title,
			...(request.width === undefined ? {} : { width: request.width }),
			...(request.height === undefined ? {} : { height: request.height }),
			additionalArguments: windowArguments({
				id: windowId,
				role: "secondary",
				view: request.view,
				params: request.params,
			}),
		});
		this.#trackWindow(kernel, windowId, window, { role: "secondary", view: request.view });
		return windowId;
	}

	#trackWindow(
		kernel: MainKernel,
		windowId: string,
		window: BrowserWindow,
		info: { readonly role: "main" | "secondary"; readonly view?: string },
	): void {
		this.#transport.attachWindow(windowId, window.webContents);
		kernel.windowEvents.opened(windowId, info);
		let confirmedClose = false;
		window.on("focus", () => {
			kernel.windowEvents.focused(windowId);
			this.#menus.focus(windowId);
		});
		window.on("blur", () => kernel.windowEvents.blurred(windowId));
		window.on("close", (event) => {
			if (confirmedClose || this.#quitting) return;
			event.preventDefault();
			void kernel.requestWindowClose(windowId).then((close) => {
				if (!close || window.isDestroyed()) return;
				confirmedClose = true;
				window.close();
			});
		});
		window.on("closed", () => {
			this.#transport.detachWindow(windowId);
			kernel.windowEvents.closed(windowId);
			this.#menus.close(windowId);
		});
	}

	#syncShortcuts(
		payload: unknown,
		from: { readonly process: string; readonly windowId?: string },
	): void {
		if (from.process !== "renderer" || !from.windowId) return;
		const contents = this.#transport.contentsOf(from.windowId);
		const { bindings, recording } = (payload ?? {}) as { bindings?: unknown; recording?: unknown };
		if (!contents || !Array.isArray(bindings)) return;
		this.#shortcuts.sync(
			contents.id,
			bindings
				.filter(
					(binding): binding is { chord: string; repeatable?: unknown } =>
						typeof (binding as { chord?: unknown } | null)?.chord === "string",
				)
				.map(({ chord, repeatable }) => ({
					chord,
					commandId: chord,
					repeatable: repeatable === true,
				})),
			recording === true,
		);
	}

	/** Command titles and current shortcuts for the menu; clicks run in the menu's window. */
	#menuCommands(windowId: string): MenuCommands {
		const kernel = this.#kernel;
		const declared = kernel?.commands.declared() ?? [];
		const titles = new Map<string, string>(
			declared.map((command) => [command.key, command.metadata.title]),
		);
		const { byCommand } = resolveKeybindings({
			commands: declared.map((command) => ({
				key: command.key,
				scoped: command.when !== undefined,
				metadata: command.metadata,
			})),
			overrides: kernel?.kernelSdk.domainObjects.get(KernelKeybindings)?.getState().overrides ?? {},
			platform: keyboardPlatform(),
		});
		return {
			title: (key) => titles.get(key),
			chord: (key) => byCommand[key]?.[0],
			run: (key) => kernel?.commands.executeInWindow(windowId, key),
		};
	}

	/** Redraws the menu when commands or their shortcuts change. */
	#watchMenuCommands(kernel: MainKernel): void {
		const stopCommands = kernel.extensions.subscribe((pointId) => {
			if (pointId === KernelCommand.id) this.#menus.refresh();
		});
		const stopKeybindings = kernel.kernelSdk.domainObjects
			.get(KernelKeybindings)
			?.subscribe(() => this.#menus.refresh());
		this.#disposers.push(stopCommands, () => stopKeybindings?.());
	}

	/**
	 * App URLs (`<scheme>://…`) reach the kernel raw; the plugin that owns
	 * deep links decides what they mean. On macOS they arrive as `open-url`
	 * (possibly before ready); elsewhere on the command line of this or a
	 * second instance.
	 */
	#watchAppUrls(kernel: MainKernel): void {
		const scheme = getDesktopScheme(this.#isDevelopment);
		const appUrlIn = (argv: readonly string[]) =>
			argv.find((argument) => argument.startsWith(`${scheme}://`));
		this.#app.setAsDefaultProtocolClient(scheme);
		const launchUrl = appUrlIn(process.argv);
		if (launchUrl) kernel.openUrl(launchUrl);
		this.#disposers.push(
			this.#app.on("open-url", (event: { preventDefault(): void }, url: string) => {
				event.preventDefault();
				this.#windows.reveal();
				kernel.openUrl(url);
			}),
			this.#app.on("second-instance", (_event: unknown, commandLine: string[]) => {
				this.#windows.reveal();
				const url = appUrlIn(commandLine);
				if (url) kernel.openUrl(url);
			}),
		);
	}

	#watchSystem(kernel: MainKernel): void {
		const onTheme = () =>
			kernel.systemEvents.update({
				appearance: nativeTheme.shouldUseDarkColors ? "dark" : "light",
			});
		const onSuspend = () => kernel.systemEvents.update({ suspended: true });
		const onResume = () => kernel.systemEvents.update({ suspended: false, online: net.isOnline() });
		const onFocus = () => kernel.systemEvents.update({ appFocused: true });
		const onBlur = () => {
			if (!BrowserWindow.getFocusedWindow()) kernel.systemEvents.update({ appFocused: false });
		};
		nativeTheme.on("updated", onTheme);
		powerMonitor.on("suspend", onSuspend);
		powerMonitor.on("resume", onResume);
		const offFocus = this.#app.on("browser-window-focus", onFocus);
		const offBlur = this.#app.on("browser-window-blur", onBlur);
		const poll = setInterval(
			() => kernel.systemEvents.update({ online: net.isOnline() }),
			ONLINE_POLL_MS,
		);
		this.#disposers.push(() => {
			nativeTheme.off("updated", onTheme);
			powerMonitor.off("suspend", onSuspend);
			powerMonitor.off("resume", onResume);
			offFocus();
			offBlur();
			clearInterval(poll);
		});
	}

	async #confirm(kind: "quit" | "window-close", reasons: readonly string[]): Promise<boolean> {
		const options: Electron.MessageBoxOptions = {
			type: "warning",
			message: kind === "quit" ? "Quit Kilo Desktop?" : "Close this window?",
			detail: reasons.join("\n"),
			buttons: [kind === "quit" ? "Quit Anyway" : "Close Anyway", "Cancel"],
			defaultId: 1,
			cancelId: 1,
		};
		const window = BrowserWindow.getFocusedWindow() ?? this.#windows.main;
		const { response } = window
			? await dialog.showMessageBox(window, options)
			: await dialog.showMessageBox(options);
		return response === 0;
	}

	#onBeforeQuit(event: { preventDefault(): void }): void {
		if (this.#quitting) return;
		event.preventDefault();
		const kernel = this.#kernel;
		if (!kernel) {
			this.#quitting = true;
			this.#app.quit();
			return;
		}
		void kernel.requestQuit().then(async (proceed) => {
			if (!proceed) return;
			this.#quitting = true;
			await this.#shutdown();
			this.#app.quit();
		});
	}

	async #relaunch(safeMode: boolean): Promise<void> {
		this.#quitting = true;
		try {
			await this.#shutdown();
		} catch (error) {
			this.#logger.error("Shutdown before relaunch failed; relaunching anyway", error);
		}
		if (this.#isDevelopment && requestDevRelaunch(safeMode, process.env)) {
			this.#app.exit(0);
			return;
		}
		const args = process.argv.slice(1).filter((argument) => argument !== SAFE_MODE_SWITCH);
		this.#app.relaunch({ args: safeMode ? [...args, SAFE_MODE_SWITCH] : args });
		this.#app.exit(0);
	}

	async #shutdown(): Promise<void> {
		await this.#kernel?.stop();
		for (const dispose of this.#disposers.splice(0).reverse()) {
			try {
				dispose();
			} catch (error) {
				this.#logger.error("Shutdown cleanup failed", error);
			}
		}
		this.#protocol.dispose();
	}
}
