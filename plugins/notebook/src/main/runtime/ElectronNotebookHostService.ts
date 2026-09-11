import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";

import {
	serveElectronNotebookHost,
	type ElectronHostMethod,
	type ElectronNotebookHostHandler,
	type ElectronNotebookHostServer,
	type ElectronRelaySession,
} from "@runtimed/node/electron";
import {
	createRelay,
	openRelayPath,
	queryDaemonInfo,
	type RelayInfo,
	type RelaySession,
} from "@runtimed/node/relay";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk/main";
import type {
	HostMessagePort,
	MainSdk,
	MainSdkHostDialogOptions,
} from "@anaconda-agentic-desktop/feature-sdk/main";

import type { NotebookOpenFileResult, NotebookSaveResult } from "../../contracts/schemas.js";

import { resolveDaemonSocketPath, type BuildChannel } from "./socket-path.js";
import { RuntimedDaemonManager, type RuntimedDaemonState } from "./RuntimedDaemonManager.js";

export interface ElectronNotebookConnectionArgs {
	readonly notebookId: string;
	readonly sessionId: string;
	readonly title: string;
	readonly notebookPath?: string;
}

export interface ElectronNotebookHostServiceOptions {
	readonly mainSdk: MainSdk;
	readonly runtimeChannel?: BuildChannel;
	readonly socketPath?: string;
	readonly runtimedBinaryPath?: string;
	readonly createDaemonManager?: (
		options: ConstructorParameters<typeof RuntimedDaemonManager>[0],
	) => RuntimedDaemonManagerLike;
}

export interface RuntimedDaemonManagerLike {
	readonly state: RuntimedDaemonState;
	ensureAvailable(): Promise<RuntimedDaemonState>;
	dispose(): Promise<void>;
}

interface PendingNotebookSave {
	readonly promise: Promise<NotebookSaveResult>;
	readonly resolve: (result: NotebookSaveResult) => void;
	timer?: ReturnType<typeof setTimeout>;
}

interface NotebookHostSession {
	readonly notebookId: string;
	readonly sessionId: string;
	readonly relay: ReconnectableRelay;
	server?: ElectronNotebookHostServer;
	title: string;
	path?: string;
	dirty: boolean;
	pendingSave: PendingNotebookSave | undefined;
	cleanup?: () => void;
}

const SAVE_COMPLETION_TIMEOUT_MS = 30_000;
const OPENED_FILE_RELAY_TIMEOUT_MS = 30_000;

interface OpenedFileRelay {
	readonly path: string;
	readonly relay: RelaySession;
	readonly timeout: ReturnType<typeof setTimeout>;
}

function notebookTitleState(title: string): { readonly dirty: boolean; readonly title: string } {
	const dirty = title.startsWith("* ");
	return { dirty, title: dirty ? title.slice(2) : title };
}

class ReconnectableRelay implements ElectronRelaySession {
	#current: RelaySession;
	#closed = false;
	readonly #frameListeners = new Set<(frame: Uint8Array) => void>();
	readonly #closeListeners = new Set<() => void>();
	#pendingFrames: Uint8Array[] = [];
	#drainingPending = false;
	#detachFrame: () => void = () => {};
	#detachClose: () => void = () => {};

	constructor(relay: RelaySession) {
		this.#current = relay;
		this.#attach();
	}

	get info(): RelayInfo {
		return this.#current.info;
	}

	send(frame: Uint8Array | ArrayBuffer): Promise<void> {
		if (this.#closed) return Promise.reject(new Error("The notebook relay is closed."));
		return this.#current.send(frame);
	}

	onFrame(listener: (frame: Uint8Array) => void): () => void {
		this.#frameListeners.add(listener);
		this.#drainingPending = true;
		try {
			while (this.#pendingFrames.length > 0) {
				const pending = this.#pendingFrames;
				this.#pendingFrames = [];
				for (const frame of pending) listener(frame);
			}
		} finally {
			this.#drainingPending = false;
		}
		return () => this.#frameListeners.delete(listener);
	}

	onClose(listener: () => void): () => void {
		this.#closeListeners.add(listener);
		return () => this.#closeListeners.delete(listener);
	}

	async replace(relay: RelaySession): Promise<void> {
		if (this.#closed) {
			await relay.close();
			throw new Error("The notebook relay is closed.");
		}
		const previous = this.#current;
		this.#detachFrame();
		this.#detachClose();
		this.#current = relay;
		this.#attach();
		await previous.close();
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#detachFrame();
		this.#detachClose();
		this.#frameListeners.clear();
		this.#closeListeners.clear();
		this.#pendingFrames = [];
		await this.#current.close();
	}

	#attach(): void {
		this.#detachFrame = this.#current.onFrame((frame) => {
			if (this.#frameListeners.size === 0 || this.#drainingPending) {
				this.#pendingFrames.push(Uint8Array.from(frame));
				return;
			}
			for (const listener of this.#frameListeners) listener(frame);
		});
		this.#detachClose = this.#current.onClose(() => {
			for (const listener of this.#closeListeners) listener();
		});
	}
}

function readyInfo(info: RelayInfo) {
	return {
		notebook_id: info.notebookId,
		...(info.cellCount === undefined ? {} : { cell_count: info.cellCount }),
		...(info.needsTrustApproval === undefined
			? {}
			: { needs_trust_approval: info.needsTrustApproval }),
		...(info.ephemeral === undefined ? {} : { ephemeral: info.ephemeral }),
		notebook_path: info.notebookPath ?? null,
		...(info.runtime === undefined ? {} : { runtime: info.runtime }),
		...(info.actorLabel === undefined ? {} : { actor_label: info.actorLabel }),
		...(info.connectionScope === undefined ? {} : { connection_scope: info.connectionScope }),
		comments_doc_id: info.commentsDocId ?? null,
		comments_notebook_ref: info.commentsNotebookRef,
	};
}

function normalizeDialogOptions(value: unknown): MainSdkHostDialogOptions | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const options = value as {
		defaultPath?: unknown;
		filters?: Array<{ name?: unknown; extensions?: unknown }>;
	};
	return {
		...(typeof options.defaultPath === "string" ? { defaultPath: options.defaultPath } : {}),
		...(Array.isArray(options.filters)
			? {
					filters: options.filters
						.filter(
							(filter): filter is { name: string; extensions: string[] } =>
								typeof filter.name === "string" &&
								Array.isArray(filter.extensions) &&
								filter.extensions.every((extension) => typeof extension === "string"),
						)
						.map((filter) => ({ name: filter.name, extensions: filter.extensions })),
				}
			: {}),
	};
}

/**
 * Owns the main-process lifetime of notebook relay and Electron host sessions.
 * Each persisted tab UUID identifies one recoverable pathless room or the
 * daemon's stable identity for a file-backed notebook. Renderer connections
 * may be replaced as tabs remount. File opens retain their initial relay briefly
 * so the renderer connection can adopt it instead of opening the same file
 * twice. Dirty state and save operations remain session-local and are always
 * settled when that connection is removed.
 */
export class ElectronNotebookHostService {
	readonly #mainSdk: MainSdk;
	readonly #socketPath: string;
	readonly #daemonManager: RuntimedDaemonManagerLike;
	readonly #sessions = new Map<string, NotebookHostSession>();
	readonly #defaultSaveDirectories = new Map<string, string>();
	readonly #openedFileRelays = new Map<string, OpenedFileRelay>();

	constructor(options: ElectronNotebookHostServiceOptions) {
		this.#mainSdk = options.mainSdk;
		this.#socketPath =
			options.socketPath ??
			resolveDaemonSocketPath({ channel: options.runtimeChannel ?? "stable" });
		const createDaemonManager =
			options.createDaemonManager ??
			((managerOptions) => new RuntimedDaemonManager(managerOptions));
		this.#daemonManager = createDaemonManager({
			binaryPath: options.runtimedBinaryPath,
			socketPath: this.#socketPath,
			allowSpawn: options.socketPath === undefined && !process.env["RUNTIMED_SOCKET_PATH"]?.trim(),
			probe: async () => (await queryDaemonInfo({ socketPath: this.#socketPath })) !== null,
			logger: this.#mainSdk.logger,
		});
	}

	get socketPath(): string {
		return this.#socketPath;
	}

	start(): Promise<RuntimedDaemonState> {
		return this.#daemonManager.ensureAvailable();
	}

	async status() {
		const process = await this.start();
		const daemon = await queryDaemonInfo({ socketPath: this.#socketPath });
		return daemon
			? {
					availability: { status: "available" as const },
					process,
					daemon: {
						version: daemon.version,
						socketPath: daemon.socketPath,
						isDevMode: daemon.isDevMode,
						blobPort: daemon.blobPort ?? null,
					},
				}
			: {
					availability: {
						status: "unavailable" as const,
						reason:
							process.status === "failed"
								? process.reason
								: "The notebook runtime daemon is not ready yet.",
					},
					process,
					daemon: null,
				};
	}

	async openFile(requestedPath: string): Promise<NotebookOpenFileResult> {
		if (!path.isAbsolute(requestedPath)) {
			throw new FeatureError("Notebook paths must be absolute.", "VALIDATION");
		}
		if (path.extname(requestedPath).toLowerCase() !== ".ipynb") {
			throw new FeatureError("Notebook files must use the .ipynb extension.", "VALIDATION");
		}

		let notebookPath: string;
		try {
			notebookPath = await realpath(requestedPath);
			const file = await stat(notebookPath);
			if (!file.isFile()) {
				throw new FeatureError("The notebook path does not point to a file.", "VALIDATION");
			}
		} catch (error) {
			if (error instanceof FeatureError) throw error;
			throw new FeatureError(`Notebook file not found: ${requestedPath}`, "NOT_FOUND");
		}

		const daemonState = await this.start();
		if (daemonState.status !== "external" && daemonState.status !== "bundled") {
			throw new FeatureError(
				"reason" in daemonState
					? daemonState.reason
					: "The notebook runtime daemon is unavailable.",
				"BUSINESS",
			);
		}

		let relay: RelaySession;
		try {
			relay = await openRelayPath(notebookPath, {
				socketPath: this.#socketPath,
				peerLabel: "agentic-desktop:open-file",
				description: path.basename(notebookPath),
			});
		} catch (error) {
			throw new FeatureError(
				`Could not open notebook: ${error instanceof Error ? error.message : String(error)}`,
				"BUSINESS",
			);
		}
		const notebookId = relay.info.notebookId;
		const previous = this.#openedFileRelays.get(notebookId);
		if (previous) {
			clearTimeout(previous.timeout);
			void previous.relay.close();
		}
		const timeout = setTimeout(() => {
			const pending = this.#openedFileRelays.get(notebookId);
			if (pending?.relay !== relay) return;
			this.#openedFileRelays.delete(notebookId);
			void relay.close();
		}, OPENED_FILE_RELAY_TIMEOUT_MS);
		timeout.unref?.();
		this.#openedFileRelays.set(notebookId, { path: notebookPath, relay, timeout });
		return {
			notebookId,
			path: notebookPath,
			title: path.basename(notebookPath),
		};
	}

	async connect(
		port: HostMessagePort,
		args: ElectronNotebookConnectionArgs,
		senderId: number,
	): Promise<void> {
		const daemonState = await this.start();
		if (daemonState.status !== "external" && daemonState.status !== "bundled") {
			throw new Error(
				"reason" in daemonState
					? daemonState.reason
					: "The notebook runtime daemon is unavailable.",
			);
		}
		let openedFileRelay = this.#takeOpenedFileRelay(args.notebookId, args.notebookPath);
		const createSession = () => {
			if (openedFileRelay) {
				const relay = openedFileRelay;
				openedFileRelay = undefined;
				return Promise.resolve(relay);
			}
			const relayOptions = {
				socketPath: this.#socketPath,
				peerLabel: `agentic-desktop:${args.sessionId}`,
				description: args.title,
			};
			return args.notebookPath
				? openRelayPath(args.notebookPath, relayOptions)
				: createRelay({
						notebookId: args.notebookId,
						ephemeral: false,
						packageManager: "conda",
						...relayOptions,
					});
		};
		const relay = new ReconnectableRelay(await createSession());
		const session: NotebookHostSession = {
			notebookId: args.notebookId,
			sessionId: args.sessionId,
			relay,
			title: relay.info.notebookPath ? path.basename(relay.info.notebookPath) : args.title,
			...(relay.info.notebookPath ? { path: relay.info.notebookPath } : {}),
			dirty: relay.info.notebookPath === undefined,
			pendingSave: undefined,
		};
		let server: ElectronNotebookHostServer | null = null;
		const reconnect = async () => {
			if (!server) throw new Error("The Electron notebook host is not connected.");
			server.emit("transport.status", "reconnecting");
			try {
				await relay.replace(await createSession());
				server.emit("daemon.ready", readyInfo(relay.info));
				server.emit("transport.status", "online");
			} catch (error) {
				server.emit("transport.status", "offline");
				throw error;
			}
		};
		let unlistenFocus: (() => void) | undefined;
		let onClose: (() => void) | undefined;
		try {
			server = serveElectronNotebookHost({
				port,
				relay,
				handler: this.#handler(session, senderId, reconnect),
			});
			const connectedServer = server;
			session.server = connectedServer;
			unlistenFocus = this.#mainSdk.host?.window.onFocusChange(senderId, (focused) => {
				connectedServer.emit("window.focusChanged", focused);
			});
			let cleaned = false;
			onClose = () => {
				if (cleaned) return;
				cleaned = true;
				port.off("close", onClose!);
				unlistenFocus?.();
				if (this.#sessions.get(session.notebookId) === session) {
					this.#sessions.delete(session.notebookId);
					this.#defaultSaveDirectories.delete(session.notebookId);
				}
				this.#settleSave(session, {
					outcome: "failed",
					reason: "The notebook was closed before saving completed.",
				});
			};
			session.cleanup = onClose;
			const previous = this.#sessions.get(session.notebookId);
			this.#sessions.set(session.notebookId, session);
			if (previous && previous !== session) void previous.server?.close();
			port.on("close", onClose);
			connectedServer.emit("daemon.ready", readyInfo(relay.info));
			connectedServer.emit(
				"window.focusChanged",
				this.#mainSdk.host?.window.isFocused(senderId) ?? true,
			);
			this.#emitDirty(session);
		} catch (error) {
			onClose?.();
			if (server) await server.close();
			else await relay.close();
			throw error;
		}
	}

	async dispose(): Promise<void> {
		const sessions = [...this.#sessions.values()];
		const openedFileRelays = [...this.#openedFileRelays.values()];
		for (const session of sessions) session.cleanup?.();
		for (const opened of openedFileRelays) clearTimeout(opened.timeout);
		await Promise.all([
			...sessions.map((session) => session.server?.close()),
			...openedFileRelays.map(({ relay }) => relay.close()),
		]);
		this.#sessions.clear();
		this.#defaultSaveDirectories.clear();
		this.#openedFileRelays.clear();
		await this.#daemonManager.dispose();
	}

	#takeOpenedFileRelay(notebookId: string, notebookPath?: string): RelaySession | undefined {
		if (!notebookPath) return undefined;
		const opened = this.#openedFileRelays.get(notebookId);
		if (!opened || opened.path !== notebookPath) return undefined;
		clearTimeout(opened.timeout);
		this.#openedFileRelays.delete(notebookId);
		return opened.relay;
	}

	setDefaultSaveDirectory(notebookId: string, directory: string | null): void {
		const validDirectory = directory && path.isAbsolute(directory) ? directory : undefined;
		if (validDirectory) this.#defaultSaveDirectories.set(notebookId, validDirectory);
		else this.#defaultSaveDirectories.delete(notebookId);
	}

	save(notebookId: string): Promise<NotebookSaveResult> {
		const session = this.#sessions.get(notebookId);
		if (!session?.server) {
			return Promise.resolve({ outcome: "failed", reason: "The notebook is not connected." });
		}
		if (!session.dirty) return Promise.resolve({ outcome: "saved" });
		if (session.pendingSave) return session.pendingSave.promise;

		let resolve!: (result: NotebookSaveResult) => void;
		const promise = new Promise<NotebookSaveResult>((settle) => {
			resolve = settle;
		});
		session.pendingSave = { promise, resolve };
		this.#startSaveTimeout(session);
		session.server.emit("command", { id: "notebook.save", payload: undefined });
		return promise;
	}

	#handler(
		session: NotebookHostSession,
		senderId: number,
		reconnect: () => Promise<void>,
	): ElectronNotebookHostHandler {
		const host = this.#mainSdk.host;
		const invoke = async (method: ElectronHostMethod, params: unknown): Promise<unknown> => {
			switch (method) {
				case "daemon.isConnected":
					return (await queryDaemonInfo({ socketPath: this.#socketPath })) !== null;
				case "daemon.reconnect":
					return reconnect();
				case "relay.prepareSync":
				case "relay.notifySyncReady":
				case "window.setTheme":
				case "settings.openWindow":
				case "settings.setSynced":
				case "updater.beginUpgrade":
					return undefined;
				case "daemon.getInfo": {
					const info = session.relay.info;
					return {
						version: info.daemonVersion ?? "unknown",
						socket_path: info.socketPath,
						is_dev_mode: info.isDevMode,
					};
				}
				case "daemon.getReadyInfo":
					return readyInfo(session.relay.info);
				case "blobs.getPort": {
					const info = session.relay.info;
					if (info.blobPort === undefined)
						throw new Error("The runtime daemon has no blob server.");
					return info.blobPort;
				}
				case "deps.checkTyposquats":
					return [];
				case "notebook.applyPathChanged": {
					const changed = params as { path?: unknown };
					if (typeof changed.path === "string") {
						session.path = changed.path;
						this.#updateTitle(session, path.basename(changed.path));
						this.#settleSave(session, { outcome: "saved" });
					}
					return undefined;
				}
				case "notebook.getDefaultSaveDirectory":
					return (
						this.#defaultSaveDirectories.get(session.notebookId) ??
						host?.paths.defaultSaveDirectory() ??
						os.homedir()
					);
				case "notebook.openInNewWindow":
				case "notebook.openHostedInNewWindow":
					throw new Error("Opening a notebook outside its Agentic side panel is unavailable.");
				case "notebook.cloneToEphemeral":
					throw new Error("Cloning the sidecar notebook is not supported by this host.");
				case "window.getTitle":
					return session.title;
				case "window.setTitle": {
					const title = (params as { title?: unknown }).title;
					if (typeof title === "string") {
						const next = notebookTitleState(title);
						this.#updateTitle(session, next.title);
						session.dirty = next.dirty;
						this.#emitDirty(session);
						if (!next.dirty) this.#settleSave(session, { outcome: "saved" });
					}
					return undefined;
				}
				case "system.getGitInfo":
					return null;
				case "system.getUsername":
					return os.userInfo().username;
				case "system.getFontFamilies":
					return [];
				case "dialog.openFile":
					if (!host) return null;
					return host.dialog.openFile(senderId, normalizeDialogOptions(params));
				case "dialog.saveFile": {
					if (!host) {
						this.#settleSave(session, { outcome: "cancelled" });
						return null;
					}
					this.#pauseSaveTimeout(session);
					const selectedPath = await host.dialog.saveFile(senderId, normalizeDialogOptions(params));
					if (selectedPath === null) this.#settleSave(session, { outcome: "cancelled" });
					else this.#startSaveTimeout(session);
					return selectedPath;
				}
				case "externalLinks.open": {
					const url = (params as { url?: unknown }).url;
					if (typeof url !== "string" || !(await host?.externalLinks.open(url))) {
						throw new Error("The external URL was rejected by the host.");
					}
					return undefined;
				}
				case "updater.check":
					return { status: "idle", version: null, error: null };
				case "settings.getSynced":
					return {};
				case "settings.rotateInstallId":
					return randomUUID();
				default: {
					const unsupported: never = method;
					throw new Error(`Unsupported Electron notebook host method: ${String(unsupported)}`);
				}
			}
		};
		return {
			invoke: invoke as ElectronNotebookHostHandler["invoke"],
			notify: ({ method, params }) => {
				const level = method.slice("log.".length) as "debug" | "info" | "warn" | "error";
				if (level === "debug") this.#mainSdk.logger.info(params.message);
				else this.#mainSdk.logger[level](params.message);
			},
		};
	}

	#emitDirty(session: NotebookHostSession): void {
		this.#mainSdk.events.emit("dirty-changed", {
			notebookId: session.notebookId,
			sessionId: session.sessionId,
			dirty: session.dirty,
		});
	}

	#updateTitle(session: NotebookHostSession, title: string): void {
		if (!title || session.title === title) return;
		session.title = title;
		this.#mainSdk.events.emit("title-changed", {
			notebookId: session.notebookId,
			sessionId: session.sessionId,
			title,
		});
	}

	#startSaveTimeout(session: NotebookHostSession): void {
		const pending = session.pendingSave;
		if (!pending || pending.timer) return;
		pending.timer = setTimeout(() => {
			this.#settleSave(session, {
				outcome: "failed",
				reason: "The notebook did not confirm the save completed.",
			});
		}, SAVE_COMPLETION_TIMEOUT_MS);
		pending.timer.unref?.();
	}

	#pauseSaveTimeout(session: NotebookHostSession): void {
		const pending = session.pendingSave;
		if (!pending?.timer) return;
		clearTimeout(pending.timer);
		delete pending.timer;
	}

	#settleSave(session: NotebookHostSession, result: NotebookSaveResult): void {
		const pending = session.pendingSave;
		if (!pending) return;
		if (pending.timer) clearTimeout(pending.timer);
		session.pendingSave = undefined;
		pending.resolve(result);
	}
}
