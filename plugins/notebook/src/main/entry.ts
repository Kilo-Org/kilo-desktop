/**
 * kilo.notebook in main: nteract's runtime (`runtimed`) and the notebooks
 * Notebook panes show.
 *
 * Ownership and lifecycle:
 * - The host service (relays, nteract's Electron host protocol, the daemon
 *   manager) belongs to the `runtimed` kernel service (`first-use`, its own
 *   restart policy): every method and frame connection that needs the runtime
 *   asks `kernel/services` to start it, and stopping the service (quit, or a
 *   restart from Diagnostics) disposes the host service, closing its
 *   notebooks; the next use creates a new one. Once the app is ready the
 *   service is started anyway, as origin started the daemon at boot, unless
 *   `KILO_NOTEBOOK_DEFER_RUNTIMED=1` (packaged e2e) defers it to first use.
 * - Every Notebook pane gets its notebook here (`NotebookPanes`): a new id,
 *   or the file it was opened for, opened when the pane is opened; a pane's
 *   window asks again for panes restored mid-open. Titles the notebook
 *   reports retitle its pane; unsaved state is `notebooks.dirty`.
 * - Frames talk to their notebook over the `host` port, adapted to the
 *   Electron port nteract's host adapter serves; the frame's bundle is the
 *   `notebook` embedded host, with outputs confined to `output-frame.html`.
 * - The Kilo server loads the notebook tool plugin through `runtime-config`;
 *   the desktop notebook tools are `kilo.agent/tool`s (signed in only).
 * - "Trust new notebooks", the workspace environment file and runtime
 *   telemetry (consent and the `notebook-host-telemetry` flag) follow
 *   connections as origin's did. Origin's saved settings and notebook facts
 *   are taken over once.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ElectronMainPort } from "@runtimed/node/electron";

import {
	definePlugin,
	KernelApp,
	KernelDataCollection,
	KernelDialogs,
	KernelError,
	KernelService,
	KernelServices,
	KernelOs,
	KernelWindows,
	mainHost,
	type DomainHandle,
	type MainHostServices,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { AgentTool, RuntimeConfigPoint } from "@kilo-desktop/plugin-agent/contracts";
import { Flags } from "@kilo-desktop/plugin-flags/contracts";
import { Panes } from "@kilo-desktop/plugin-sessions/contracts";

import {
	DEFAULT_NOTEBOOK_SETTINGS,
	NOTEBOOK_HOST,
	NOTEBOOK_HOST_PORT,
	NOTEBOOK_PANE_KIND,
	notebookConnectionArgsSchema,
	Notebooks,
	RUNTIMED_SERVICE_KEY,
	type NotebookOpenFileResult,
	type NotebookSaveResult,
	type NotebookStatus,
} from "../contracts/index.js";
import { findRuntimedArtifact, NTERACT_RELEASE } from "../packaging/artifacts.js";
import { resolveNotebookBundleRoot } from "./embedding/notebook-bundle-path.js";
import { electronMainPort } from "./electron-port.js";
import { WorkspaceEnvironment } from "./environment/workspace-environment.js";
import { importOriginNotebookData } from "./import-origin.js";
import { NotebookPanes } from "./notebook-panes.js";
import { notebookRuntimeConfig } from "./runtime-config.js";
import type {
	ElectronNotebookConnectionArgs,
	ElectronNotebookHostServiceOptions,
	NotebookHostPlatform,
} from "./runtime/ElectronNotebookHostService.js";
import { NewNotebookTrust, type TrustSession } from "./runtime/NewNotebookTrust.js";
import {
	NotebookTelemetryPermission,
	type OpenTelemetryRegistration,
} from "./runtime/NotebookTelemetryPermission.js";
import type { RuntimedDaemonState } from "./runtime/RuntimedDaemonManager.js";
import { resolveDaemonSocketPath, type BuildChannel } from "./runtime/socket-path.js";
import { NotebookSettingsStore, NotebookStateStore } from "./settings/NotebookSettingsStore.js";
import { notebookTools } from "./tools.js";

/** What the entry needs from the host service (a fake in tests). */
export interface NotebookHostServiceLike {
	start(): Promise<RuntimedDaemonState>;
	status(): Promise<NotebookStatus>;
	openFile(path: string): Promise<NotebookOpenFileResult>;
	save(notebookId: string): Promise<NotebookSaveResult>;
	setDefaultSaveDirectory(notebookId: string, directory: string | null): void;
	connect(
		port: ElectronMainPort,
		args: ElectronNotebookConnectionArgs,
		windowId: string,
	): Promise<void>;
	dispose(): Promise<void>;
}

export interface NotebookMainOptions {
	readonly createHostService: (
		options: ElectronNotebookHostServiceOptions,
	) => NotebookHostServiceLike;
	/** An explicit daemon endpoint (attach-only); defaults to `RUNTIMED_SOCKET_PATH`. */
	readonly socketPath?: string;
	/** Selects the user-owned singleton; defaults to the pinned release's channel. */
	readonly runtimeChannel?: BuildChannel;
	readonly resolveRuntimedBinary?: (host: MainHostServices) => string | undefined;
	readonly resolveBundleRoot?: (host: MainHostServices) => string | undefined;
	readonly resolveKiloPluginEntry?: (host: MainHostServices) => string | undefined;
	readonly resolveRuntimedNodeEntry?: () => string | undefined;
	/** Opens the extra peer "Trust new notebooks" holds per notebook. */
	readonly openTrustSession?: (notebookId: string, socketPath: string) => Promise<TrustSession>;
	readonly openTelemetryRegistration?: OpenTelemetryRegistration;
	/** Project-file discovery's home-directory boundary. */
	readonly homeDirectory?: string;
	/** Origin's storage folder, whose settings are taken over once. */
	readonly originStorageDir?: (storageDir: string) => string;
	/** Starts the runtime once the app is ready (default: unless `KILO_NOTEBOOK_DEFER_RUNTIMED=1`). */
	readonly warmStart?: boolean;
	readonly createId?: () => string;
}

/** nteract's copy buttons call navigator.clipboard; outputs stay in opaque-origin frames. */
const CLIPBOARD_WRITE_PERMISSION = "clipboard-sanitized-write";
const ACTIVE_UNTRUSTED_CONTENT = "active-untrusted-content";
const TELEMETRY_FLAG = "notebook-host-telemetry";
const EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function resolveAsset(host: MainHostServices, subpath: string): string | undefined {
	try {
		const candidate = host.assets?.resolve(subpath);
		return candidate && existsSync(candidate) ? candidate : undefined;
	} catch {
		return undefined;
	}
}

function defaultRuntimedBinary(host: MainHostServices): string | undefined {
	const artifact = findRuntimedArtifact();
	return artifact
		? resolveAsset(host, `resources/runtimed/${artifact.target}/${artifact.executable}`)
		: undefined;
}

function defaultBundleRoot(host: MainHostServices): string | undefined {
	const candidate = resolveAsset(host, "resources/notebook");
	return candidate ? resolveNotebookBundleRoot({ candidate }) : undefined;
}

function defaultDocumentsDirectory(): string {
	const documents = path.join(os.homedir(), "Documents");
	return existsSync(documents) ? documents : os.homedir();
}

function isExternalLink(url: string): boolean {
	try {
		return EXTERNAL_LINK_PROTOCOLS.has(new URL(url).protocol);
	} catch {
		return false;
	}
}

/** The app as nteract's host protocol sees it: kernel dialogs, windows and links. */
function hostPlatform(
	sdk: PluginSdk,
	events: NotebookHostPlatform["events"],
): NotebookHostPlatform {
	const windows = () => sdk.domains.get(KernelWindows);
	return {
		logger: sdk.logger,
		events,
		host: {
			paths: { defaultSaveDirectory: defaultDocumentsDirectory },
			dialog: {
				openFile: async (_windowId, options) => {
					const dialogs = sdk.domains.get(KernelDialogs);
					if (!dialogs) return null;
					const { paths } = await dialogs.methods.open({
						...(options?.defaultPath ? { defaultPath: options.defaultPath } : {}),
						...(options?.filters ? { filters: options.filters.map(copyFilter) } : {}),
					});
					return paths[0] ?? null;
				},
				saveFile: async (_windowId, options) => {
					const dialogs = sdk.domains.get(KernelDialogs);
					if (!dialogs) return null;
					const { path: chosen } = await dialogs.methods.save({
						...(options?.defaultPath ? { defaultPath: options.defaultPath } : {}),
						...(options?.filters ? { filters: options.filters.map(copyFilter) } : {}),
					});
					return chosen;
				},
			},
			externalLinks: {
				open: async (url) => {
					const os = sdk.domains.get(KernelOs);
					if (!os || !isExternalLink(url)) return false;
					return os.methods.openExternal({ url }).catch(() => false);
				},
			},
			window: {
				isFocused: (windowId) => windows()?.getState().windows[windowId]?.focused ?? true,
				onFocusChange: (windowId, listener) => {
					const handle = windows();
					if (!handle) return () => undefined;
					const stopFocused = handle.on("focused", (event) => {
						if (event.windowId === windowId) listener(true);
					});
					const stopBlurred = handle.on("blurred", (event) => {
						if (event.windowId === windowId) listener(false);
					});
					return () => {
						stopFocused();
						stopBlurred();
					};
				},
			},
		},
	};
}

const copyFilter = (filter: { readonly name: string; readonly extensions: readonly string[] }) => ({
	name: filter.name,
	extensions: [...filter.extensions],
});

export function createNotebookMainEntry(options: NotebookMainOptions): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const host = mainHost(sdk);
			const settings = new NotebookSettingsStore(host.storage);
			const notebookState = new NotebookStateStore(host.storage);
			const explicitSocket =
				options.socketPath ?? (process.env["RUNTIMED_SOCKET_PATH"]?.trim() || undefined);
			const runtimeChannel = options.runtimeChannel ?? NTERACT_RELEASE.channel;
			const socketPath = explicitSocket ?? resolveDaemonSocketPath({ channel: runtimeChannel });
			const runtimedBinaryPath = (options.resolveRuntimedBinary ?? defaultRuntimedBinary)(host);
			let panesHandle: DomainHandle<typeof Panes> | null = null;

			const notebooks = sdk.domains.provide(Notebooks, {
				initialState: { settings: DEFAULT_NOTEBOOK_SETTINGS, dirty: {} },
				methods: {
					status: async () => (await ensureRuntime()).status(),
					save: async ({ notebookId }) => (await ensureRuntime()).save(notebookId),
					updateSettings: (patch) => {
						const next = settings.update(patch);
						notebooks.update((state) => ({ ...state, settings: next }));
						trust.refresh();
						return next;
					},
					prepareEnvironment: (request) => workspaceEnvironment.prepare(request),
					resolvePane: async ({ sessionId, paneId }) => {
						await notebookPanes.resolve(sessionId, paneId);
					},
				},
			});
			const syncSettings = () =>
				notebooks.update((state) => ({ ...state, settings: settings.get() }));
			syncSettings();
			if (options.originStorageDir) {
				const originDir = options.originStorageDir(host.storage.dir);
				void importOriginNotebookData(originDir, settings, notebookState).then(
					syncSettings,
					(error: unknown) =>
						sdk.logger.warn(
							`Could not import notebook settings from ${originDir}; will try again next launch: ${errorMessage(error)}`,
						),
				);
			}

			const workspaceEnvironment = new WorkspaceEnvironment({
				settings: () => settings.get(),
				state: notebookState,
				...(options.homeDirectory ? { homeDirectory: options.homeDirectory } : {}),
			});

			const reportTelemetryError = () =>
				sdk.logger.warn("Notebook telemetry permission reconciliation failed.");
			const telemetry = new NotebookTelemetryPermission({
				socketPath,
				openRegistration: options.openTelemetryRegistration ?? (async () => null),
				readFeatureFlag: () => sdk.domains.get(Flags)?.getState().flags[TELEMETRY_FLAG],
			});
			const trust = new NewNotebookTrust({
				openNotebook: (notebookId) =>
					options.openTrustSession
						? options.openTrustSession(notebookId, socketPath)
						: Promise.reject(new Error("Trusting notebooks is unavailable.")),
				isEnabled: () => settings.get().trustNewNotebooks,
				logger: sdk.logger,
			});
			sdk.onDispose(async () => {
				try {
					await telemetry.dispose();
				} finally {
					await trust.dispose();
				}
			});
			let allowed = false;
			void telemetry.setAllowed(allowed).catch(reportTelemetryError);
			const followConsent = (next: boolean) => {
				if (next === allowed) return;
				allowed = next;
				void telemetry.setAllowed(allowed).catch(reportTelemetryError);
			};
			sdk.onDispose(
				sdk.domains.track(KernelDataCollection, {
					added: (handle) => {
						followConsent(handle.getState().allowed);
						sdk.onDispose(handle.subscribe((state) => followConsent(state.allowed)));
					},
					removed: () => followConsent(false),
				}),
			);
			let flag: unknown;
			const followFlag = (next: unknown) => {
				if (next === flag) return;
				flag = next;
				void telemetry.refreshFeatureFlag().catch(reportTelemetryError);
			};
			void telemetry.refreshFeatureFlag().catch(reportTelemetryError);
			sdk.onDispose(
				sdk.domains.track(Flags, {
					added: (handle) => {
						followFlag(handle.getState().flags[TELEMETRY_FLAG]);
						sdk.onDispose(handle.subscribe((state) => followFlag(state.flags[TELEMETRY_FLAG])));
					},
					removed: () => followFlag(undefined),
				}),
			);

			const setDirty = (notebookId: string, dirty: boolean) =>
				notebooks.update((state) => {
					if ((state.dirty[notebookId] === true) === dirty) return state;
					const { [notebookId]: _previous, ...rest } = state.dirty;
					return { ...state, dirty: dirty ? { ...rest, [notebookId]: true } : rest };
				});
			const platform = hostPlatform(sdk, {
				emit: (event: "dirty-changed" | "title-changed", payload: unknown) => {
					if (event === "dirty-changed") {
						const { notebookId, dirty } = payload as { notebookId: string; dirty: boolean };
						setDirty(notebookId, dirty);
						return;
					}
					const { notebookId, title } = payload as { notebookId: string; title: string };
					const located = notebookPanes.locate(notebookId);
					if (!located || located.pane.title === title || !panesHandle) return;
					void panesHandle.methods
						.update({ sessionId: located.sessionId, paneId: located.pane.id, title })
						.catch(() => undefined);
				},
			} as NotebookHostPlatform["events"]);

			let hostService: NotebookHostServiceLike | undefined;
			const acquire = () =>
				(hostService ??= options.createHostService({
					platform,
					...(explicitSocket ? { socketPath: explicitSocket } : {}),
					runtimeChannel,
					...(runtimedBinaryPath ? { runtimedBinaryPath } : {}),
					onNotebookConnected: ({ notebookId, untitled }) => {
						if (untitled) notebookState.markCreatedHere(notebookId);
						if (notebookState.isCreatedHere(notebookId)) trust.track(notebookId);
						void telemetry.setNotebookActive(notebookId, true).catch(reportTelemetryError);
					},
					onNotebookDisconnected: (notebookId) => {
						trust.untrack(notebookId);
						setDirty(notebookId, false);
						void telemetry.setNotebookActive(notebookId, false).catch(reportTelemetryError);
					},
				}));
			const release = async () => {
				const current = hostService;
				hostService = undefined;
				await current?.dispose();
			};
			sdk.onDispose(release);

			sdk.extensions.implement(KernelService, "runtimed", {
				start: async () => {
					const state = await acquire().start();
					if (state.status === "failed") throw new KernelError("UNAVAILABLE", state.reason);
				},
				stop: release,
			});
			const ensureRuntime = async () => {
				// A failed start shows in Diagnostics; the caller still gets the runtime's own answer.
				await sdk.domains
					.get(KernelServices)
					?.methods.ensureStarted({ key: RUNTIMED_SERVICE_KEY })
					.catch(() => undefined);
				return acquire();
			};

			const notebookPanes = new NotebookPanes({
				panes: () => panesHandle,
				openFile: async (file) => (await ensureRuntime()).openFile(file),
				createId: options.createId ?? (() => crypto.randomUUID()),
			});
			sdk.onDispose(
				sdk.domains.track(Panes, {
					added: (handle) => {
						panesHandle = handle;
						const stop = handle.on("opened", ({ sessionId, pane }) => {
							if (pane.kind !== NOTEBOOK_PANE_KIND) return;
							void notebookPanes.resolve(sessionId, pane.id).catch(() => undefined);
						});
						sdk.onDispose(stop);
					},
					removed: () => {
						panesHandle = null;
					},
				}),
			);

			for (const [id, tool] of Object.entries(
				notebookTools({ panes: () => panesHandle, notebookPanes }),
			)) {
				sdk.extensions.implement(AgentTool, id, tool);
			}

			sdk.extensions.implement(
				RuntimeConfigPoint,
				"kilo-plugin",
				notebookRuntimeConfig(
					{
						pluginPath: (
							options.resolveKiloPluginEntry ??
							((services) => resolveAsset(services, "resources/kilo-plugin/index.js"))
						)(host),
						runtimedNodePath: options.resolveRuntimedNodeEntry?.(),
						socketPath,
					},
					sdk.logger,
				),
			);

			sdk.ports.handle(NOTEBOOK_HOST_PORT, (port, args, caller) => {
				const parsed = notebookConnectionArgsSchema.safeParse(args);
				const { notebookPath, workingDirectory } = parsed.success ? parsed.data : {};
				if (
					!parsed.success ||
					(notebookPath &&
						(!path.isAbsolute(notebookPath) ||
							path.extname(notebookPath).toLowerCase() !== ".ipynb")) ||
					(workingDirectory && !path.isAbsolute(workingDirectory))
				) {
					sdk.logger.warn("Refused a notebook connection with invalid arguments.");
					port.close();
					return;
				}
				void ensureRuntime()
					.then((service) => {
						service.setDefaultSaveDirectory(parsed.data.notebookId, workingDirectory ?? null);
						const { notebookId, sessionId, title } = parsed.data;
						return service.connect(
							electronMainPort(port),
							{
								notebookId,
								sessionId,
								title,
								...(notebookPath ? { notebookPath } : {}),
								...(workingDirectory ? { workingDirectory } : {}),
							},
							caller.windowId,
						);
					})
					.catch((error: unknown) => {
						sdk.logger.warn(`Could not connect a notebook: ${errorMessage(error)}`);
						port.close();
					});
			});

			if (host.embeddedHosts) {
				sdk.onDispose(
					host.embeddedHosts.register({
						host: NOTEBOOK_HOST,
						root: (options.resolveBundleRoot ?? defaultBundleRoot)(host),
						securityProfiles: { "/output-frame.html": ACTIVE_UNTRUSTED_CONTENT },
						permissions: [CLIPBOARD_WRITE_PERMISSION],
					}),
				);
			}

			const warmStart = options.warmStart ?? process.env["KILO_NOTEBOOK_DEFER_RUNTIMED"] !== "1";
			const app = sdk.domains.get(KernelApp);
			if (warmStart && app) {
				const warm = () => void ensureRuntime().catch(() => undefined);
				if (app.getState().phase === "ready") warm();
				else {
					const stop = app.on("phase-changed", ({ phase }) => {
						if (phase !== "ready") return;
						stop();
						warm();
					});
					sdk.onDispose(stop);
				}
			}
		},
	});
}
