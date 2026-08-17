import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
	serveElectronNotebookHost,
	type ElectronHostMethod,
	type ElectronNotebookHostHandler,
	type ElectronNotebookHostServer,
	type ElectronRelaySession,
} from "@runtimed/node/electron";
import {
	createRelay,
	queryDaemonInfo,
	type RelayInfo,
	type RelaySession,
} from "@runtimed/node/relay";

import type {
	HostMessagePort,
	MainSdk,
	MainSdkHostDialogOptions,
} from "@anaconda-agentic-desktop/feature-sdk/main";

import { resolveDaemonSocketPath, type BuildChannel } from "./socket-path.js";
import { RuntimedDaemonManager, type RuntimedDaemonState } from "./RuntimedDaemonManager.js";

export interface ElectronNotebookConnectionArgs {
	readonly notebookId: string;
	readonly sessionId: string;
	readonly title: string;
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

export class ElectronNotebookHostService {
	readonly #mainSdk: MainSdk;
	readonly #socketPath: string;
	readonly #daemonManager: RuntimedDaemonManagerLike;
	readonly #servers = new Map<ElectronNotebookHostServer, () => void>();

	constructor(options: ElectronNotebookHostServiceOptions) {
		this.#mainSdk = options.mainSdk;
		this.#socketPath =
			options.socketPath ??
			resolveDaemonSocketPath({ channel: options.runtimeChannel ?? "nightly" });
		const createDaemonManager =
			options.createDaemonManager ??
			((managerOptions) => new RuntimedDaemonManager(managerOptions));
		this.#daemonManager = createDaemonManager({
			binaryPath: options.runtimedBinaryPath,
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
		const createSession = () =>
			createRelay({
				notebookId: args.notebookId,
				ephemeral: true,
				socketPath: this.#socketPath,
				peerLabel: `agentic-desktop:${args.sessionId}`,
				description: args.title,
			});
		const relay = new ReconnectableRelay(await createSession());
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
				handler: this.#handler(() => relay.info, senderId, reconnect),
			});
			const connectedServer = server;
			unlistenFocus = this.#mainSdk.host?.window.onFocusChange(senderId, (focused) => {
				connectedServer.emit("window.focusChanged", focused);
			});
			let cleaned = false;
			onClose = () => {
				if (cleaned) return;
				cleaned = true;
				port.off("close", onClose!);
				unlistenFocus?.();
				this.#servers.delete(connectedServer);
			};
			this.#servers.set(connectedServer, onClose);
			port.on("close", onClose);
			connectedServer.emit("daemon.ready", readyInfo(relay.info));
			connectedServer.emit(
				"window.focusChanged",
				this.#mainSdk.host?.window.isFocused(senderId) ?? true,
			);
		} catch (error) {
			onClose?.();
			if (server) await server.close();
			else await relay.close();
			throw error;
		}
	}

	async dispose(): Promise<void> {
		const sessions = [...this.#servers];
		for (const [, cleanup] of sessions) cleanup();
		await Promise.all(sessions.map(([server]) => server.close()));
		this.#servers.clear();
		await this.#daemonManager.dispose();
	}

	#handler(
		getInfo: () => RelayInfo,
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
					const info = getInfo();
					return {
						version: info.daemonVersion ?? "unknown",
						socket_path: info.socketPath,
						is_dev_mode: info.isDevMode,
					};
				}
				case "daemon.getReadyInfo":
					return readyInfo(getInfo());
				case "blobs.getPort": {
					const info = getInfo();
					if (info.blobPort === undefined)
						throw new Error("The runtime daemon has no blob server.");
					return info.blobPort;
				}
				case "deps.checkTyposquats":
					return [];
				case "notebook.applyPathChanged": {
					const changed = params as { path?: unknown };
					if (typeof changed.path === "string") {
						host?.window.setTitle(senderId, path.basename(changed.path));
					}
					return undefined;
				}
				case "notebook.getDefaultSaveDirectory":
					return host?.paths.defaultSaveDirectory() ?? os.homedir();
				case "notebook.openInNewWindow":
				case "notebook.openHostedInNewWindow":
					throw new Error("Opening a notebook outside its Agentic side panel is unavailable.");
				case "notebook.cloneToEphemeral":
					throw new Error("Cloning the sidecar notebook is not supported by this host.");
				case "window.getTitle":
					return host?.window.getTitle(senderId) ?? "Notebook";
				case "window.setTitle": {
					const title = (params as { title?: unknown }).title;
					if (typeof title === "string") host?.window.setTitle(senderId, title);
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
				case "dialog.saveFile":
					if (!host) return null;
					return host.dialog.saveFile(senderId, normalizeDialogOptions(params));
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
}
