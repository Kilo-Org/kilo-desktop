import type { BrowserWindow } from "electron";

import {
	KernelAppMenu,
	KernelClipboard,
	KernelDataCollection,
	KernelDialogs,
	KernelError,
	KernelKeychain,
	KernelNativeTheme,
	KernelNotifications,
	KernelOs,
	KernelUpdater,
	type AppMenuNode,
	type PluginSdk,
} from "@kilo-desktop/kernel";

type ThemeSource = "system" | "light" | "dark";
type UpdaterActionResult = { readonly accepted: boolean; readonly state: unknown };
type ChromeColors = { readonly background: string; readonly foreground: string };
export type NativeChrome = { readonly light: ChromeColors; readonly dark: ChromeColors };

/** The Electron capabilities the host primitives are built on, injected so they can be tested. */
export interface HostPrimitiveDeps {
	readonly focusedWindow: () => BrowserWindow | undefined;
	readonly dialog: {
		showOpenDialog(
			window: BrowserWindow | undefined,
			options: Electron.OpenDialogOptions,
		): Promise<{ canceled: boolean; filePaths: string[] }>;
		showSaveDialog(
			window: BrowserWindow | undefined,
			options: Electron.SaveDialogOptions,
		): Promise<{ canceled: boolean; filePath?: string }>;
		showMessageBox(
			window: BrowserWindow | undefined,
			options: Electron.MessageBoxOptions,
		): Promise<{ response: number }>;
	};
	readonly clipboard: {
		writeText(text: string): void | Promise<void>;
	};
	readonly os: {
		openExternal(url: string): Promise<boolean>;
		/** Reveals a file; false when the path was refused or the OS failed. */
		showItemInFolder(path: string): boolean;
		/** Reveals the log file; false when the OS refused. */
		showLogs(): boolean;
		logFilePath(): string;
	};
	readonly dataCollection: {
		choice(): boolean;
		allowed(): boolean;
		installationId(): string;
		readonly environment: string;
		setChoice(allow: boolean): Promise<void>;
		onChange(listener: () => void): () => void;
	};
	readonly notifications: {
		show(input: { title: string; message: string; silent?: boolean }): { delivered: boolean };
		setBadge(count: number): { delivered: boolean };
	};
	readonly keychain: {
		get(account: string): Promise<string | null>;
		set(account: string, value: string): Promise<void>;
		delete(account: string): Promise<void>;
	};
	/** A window's native menu tree, to show while that window is focused. */
	readonly appMenu: (windowId: string, menus: readonly AppMenuNode[]) => void;
	readonly nativeTheme: {
		readonly source: ThemeSource;
		shouldUseDarkColors(): boolean;
		onUpdated(listener: () => void): () => void;
		setSource(source: ThemeSource): void;
		setChrome(chrome: NativeChrome): void;
	};
	readonly updater?: {
		readonly state: unknown;
		onChange(listener: (state: unknown) => void): () => void;
		check(): Promise<UpdaterActionResult>;
		install(): UpdaterActionResult;
		setTrack(track: string): Promise<UpdaterActionResult>;
	};
}

/**
 * Provides the kernel's host-primitive domain objects. Each one requires the
 * matching host permission from callers (checked by the domain registry);
 * keychain entries are namespaced by the calling plugin, and an app menu
 * belongs to the window that set it.
 */
export function provideHostPrimitives(kernelSdk: PluginSdk, deps: HostPrimitiveDeps): void {
	kernelSdk.domainObjects.provide(KernelDialogs, {
		initialState: {},
		methods: {
			open: async ({ title, directory, multiple, defaultPath, filters }) => {
				const result = await deps.dialog.showOpenDialog(deps.focusedWindow(), {
					...(title ? { title } : {}),
					...(defaultPath ? { defaultPath } : {}),
					...(filters ? { filters } : {}),
					properties: [
						directory ? "openDirectory" : "openFile",
						...(multiple ? (["multiSelections"] as const) : []),
					],
				});
				return { paths: result.canceled ? [] : result.filePaths };
			},
			save: async ({ title, defaultPath, filters }) => {
				const result = await deps.dialog.showSaveDialog(deps.focusedWindow(), {
					...(title ? { title } : {}),
					...(defaultPath ? { defaultPath } : {}),
					...(filters ? { filters } : {}),
				});
				return { path: result.canceled ? null : (result.filePath ?? null) };
			},
			message: async ({ type, message, detail, buttons, defaultId, cancelId }) => {
				const result = await deps.dialog.showMessageBox(deps.focusedWindow(), {
					message,
					buttons,
					...(type ? { type } : {}),
					...(detail ? { detail } : {}),
					...(defaultId === undefined ? {} : { defaultId }),
					...(cancelId === undefined ? {} : { cancelId }),
				});
				return { response: result.response };
			},
		},
	});

	kernelSdk.domainObjects.provide(KernelClipboard, {
		initialState: {},
		methods: {
			writeText: ({ text }) => deps.clipboard.writeText(text),
		},
	});

	kernelSdk.domainObjects.provide(KernelOs, {
		initialState: {},
		methods: {
			openExternal: ({ url }) => deps.os.openExternal(url),
			showItemInFolder: ({ path }) => {
				if (!deps.os.showItemInFolder(path)) {
					throw new KernelError("BUSINESS", "The file could not be shown in the file manager.");
				}
			},
			showLogs: () => ({ revealed: deps.os.showLogs() }),
			logFilePath: () => deps.os.logFilePath(),
		},
	});

	const consent = deps.dataCollection;
	const consentState = () => ({
		choice: consent.choice(),
		allowed: consent.allowed(),
		installationId: consent.installationId(),
		environment: consent.environment,
	});
	const dataCollection = kernelSdk.domainObjects.provide(KernelDataCollection, {
		initialState: consentState(),
		methods: {
			setChoice: async ({ allowed }) => {
				try {
					await consent.setChoice(allowed);
				} catch (cause) {
					throw new KernelError(
						"BUSINESS",
						cause instanceof Error ? cause.message : "Could not update privacy settings.",
					);
				} finally {
					dataCollection.setState(consentState());
				}
			},
		},
	});
	consent.onChange(() => dataCollection.setState(consentState()));

	kernelSdk.domainObjects.provide(KernelNotifications, {
		initialState: {},
		methods: {
			show: ({ title, body, silent }) =>
				deps.notifications.show({
					title,
					message: body ?? "",
					...(silent === undefined ? {} : { silent }),
				}),
			setBadge: ({ count }) => void deps.notifications.setBadge(count),
		},
	});

	kernelSdk.domainObjects.provide(KernelAppMenu, {
		initialState: {},
		methods: {
			setMenu: ({ menus }, caller) => {
				if (caller.windowId === undefined) {
					throw new KernelError("VALIDATION", "An app menu is set from the window it belongs to.");
				}
				deps.appMenu(caller.windowId, menus);
			},
		},
	});

	const nativeTheme = kernelSdk.domainObjects.provide(KernelNativeTheme, {
		initialState: {
			source: deps.nativeTheme.source,
			shouldUseDarkColors: deps.nativeTheme.shouldUseDarkColors(),
		},
		methods: {
			setSource: ({ source }) => {
				deps.nativeTheme.setSource(source);
				nativeTheme.setState({
					source,
					shouldUseDarkColors: deps.nativeTheme.shouldUseDarkColors(),
				});
			},
			setChrome: (chrome) => deps.nativeTheme.setChrome(chrome),
		},
	});
	deps.nativeTheme.onUpdated(() =>
		nativeTheme.update((state) => ({
			...state,
			shouldUseDarkColors: deps.nativeTheme.shouldUseDarkColors(),
		})),
	);

	const account = (pluginId: string, key: string) => `${pluginId}:${key}`;
	kernelSdk.domainObjects.provide(KernelKeychain, {
		initialState: {},
		methods: {
			get: ({ key }, caller) => deps.keychain.get(account(caller.pluginId, key)),
			set: ({ key, value }, caller) => deps.keychain.set(account(caller.pluginId, key), value),
			delete: ({ key }, caller) => deps.keychain.delete(account(caller.pluginId, key)),
		},
	});

	const updater = deps.updater;
	if (updater) {
		const provider = kernelSdk.domainObjects.provide(KernelUpdater, {
			initialState: KernelUpdater.state.parse(updater.state),
			methods: {
				check: async () => actionResult(await updater.check()),
				install: () => actionResult(updater.install()),
				setTrack: async ({ track }) => actionResult(await updater.setTrack(track)),
			},
		});
		updater.onChange((state) => provider.setState(KernelUpdater.state.parse(state)));
	}
}

function actionResult(result: UpdaterActionResult) {
	return { accepted: result.accepted, state: KernelUpdater.state.parse(result.state) };
}
