import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";

import {
	serveElectronNotebookHost,
	type ElectronHostMethod,
	type ElectronMainPort,
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

import { KernelError, type KernelLogger } from "@kilo-desktop/kernel";

import type { NotebookOpenFileResult, NotebookSaveResult } from "../../contracts";

import { resolveDaemonSocketPath, type BuildChannel } from "./socket-path";
import { RuntimedDaemonManager, type RuntimedDaemonState } from "./RuntimedDaemonManager";
import { createDaemonPeerAuthenticator } from "./daemon-peer-authenticator";
import { findRuntimedArtifact } from "../../packaging/artifacts";
import { checkTyposquats } from "../../shared/typosquat";
import {
	isPeerCredentialBackendAvailable,
	resolveDaemonPeerIdentity,
	type PeerCredentialResolver,
} from "./peer-credentials";

export interface ElectronNotebookConnectionArgs {
	readonly notebookId: string;
	readonly workSessionId: string;
	readonly title: string;
	readonly notebookPath?: string;
	readonly workingDirectory?: string;
}

export interface NotebookDialogOptions {
	readonly defaultPath?: string;
	readonly filters?: readonly { readonly name: string; readonly extensions: readonly string[] }[];
}

/** What the host service needs from the app: windows, dialogs, links and where its notebooks report. */
export interface NotebookHostPlatform {
	readonly logger: Pick<KernelLogger, "debug" | "info" | "warn" | "error">;
	readonly host?: {
		readonly paths: { defaultSaveDirectory(): string };
		readonly dialog: {
			openFile(windowId: string, options?: NotebookDialogOptions): Promise<string | null>;
			saveFile(windowId: string, options?: NotebookDialogOptions): Promise<string | null>;
		};
		readonly externalLinks: { open(url: string): Promise<boolean> };
		readonly window: {
			isFocused(windowId: string): boolean;
			onFocusChange(windowId: string, listener: (focused: boolean) => void): () => void;
		};
	};
	readonly events: {
		emit(event: "dirty-changed", payload: NotebookDirtyChanged): void;
		emit(event: "title-changed", payload: NotebookTitleChanged): void;
	};
}

export interface NotebookDirtyChanged {
	readonly notebookId: string;
	readonly workSessionId: string;
	readonly dirty: boolean;
}

export interface NotebookTitleChanged {
	readonly notebookId: string;
	readonly workSessionId: string;
	readonly title: string;
}

export interface ElectronNotebookHostServiceOptions {
	readonly platform: NotebookHostPlatform;
	readonly runtimeChannel?: BuildChannel;
	readonly socketPath?: string;
	readonly runtimedBinaryPath?: string;
	readonly createDaemonManager?: (
		options: ConstructorParameters<typeof RuntimedDaemonManager>[0],
	) => RuntimedDaemonManagerLike;
	/** Test seam for the OS peer-credential lookup used to authenticate the daemon. */
	readonly resolvePeerIdentity?: PeerCredentialResolver;
	/**
	 * Probes whether the native peer-credential backend can load, to warn when it
	 * cannot (every daemon would then be denied). Defaults to the real koffi
	 * probe; tests pass a stub to keep the constructor side-effect-free.
	 */
	readonly probePeerCredentialBackend?: () => Promise<boolean>;
	/** Called once a notebook's host connection is live; `untitled` means created here, not opened from disk. */
	readonly onNotebookConnected?: (notebook: {
		readonly notebookId: string;
		readonly untitled: boolean;
	}) => void;
	readonly onNotebookDisconnected?: (notebookId: string) => void;
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
	readonly workSessionId: string;
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

const MAX_TYPOSQUAT_PACKAGES = 500;
const MAX_TYPOSQUAT_SPEC_LENGTH = 512;

/** The notebook iframe is untrusted input; reject rather than silently report "no warnings". */
function typosquatCheckPackages(params: unknown): string[] {
	const packages = (params as { packages?: unknown } | null | undefined)?.packages;
	if (
		!Array.isArray(packages) ||
		packages.length > MAX_TYPOSQUAT_PACKAGES ||
		!packages.every(
			(spec): spec is string =>
				typeof spec === "string" && spec.length <= MAX_TYPOSQUAT_SPEC_LENGTH,
		)
	) {
		throw new Error(
			`deps.checkTyposquats requires packages: string[] (at most ${MAX_TYPOSQUAT_PACKAGES} specs of ${MAX_TYPOSQUAT_SPEC_LENGTH} characters).`,
		);
	}
	return packages;
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

/**
 * Daemon capabilities the embedded notebook gates its environment picker on.
 * `installedKernelspecs` is newer than the pinned binding's `RelayInfo` type,
 * so both are read structurally; absent means unsupported and is not forwarded.
 */
type RelayCapabilities = { localEnvironmentSelection?: unknown; installedKernelspecs?: unknown };

function capabilityFlags(info: RelayInfo) {
	const { localEnvironmentSelection, installedKernelspecs } = info as RelayCapabilities;
	return {
		...(typeof localEnvironmentSelection === "boolean"
			? { local_environment_selection: localEnvironmentSelection }
			: {}),
		...(typeof installedKernelspecs === "boolean"
			? { installed_kernelspecs: installedKernelspecs }
			: {}),
	};
}

function readyInfo(info: RelayInfo) {
	return {
		...capabilityFlags(info),
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
		...(info.keyedDocKinds.length > 0 ? { keyed_doc_kinds: info.keyedDocKinds } : {}),
		comments_doc_id: info.commentsDocId ?? null,
		comments_notebook_ref: info.commentsNotebookRef,
	};
}

function normalizeDialogOptions(value: unknown): NotebookDialogOptions | undefined {
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
 * settled when that connection is removed. New scratch rooms inherit the
 * connected chat's working directory at creation.
 */
export class ElectronNotebookHostService {
	readonly #platform: NotebookHostPlatform;
	readonly #socketPath: string;
	readonly #daemonManager: RuntimedDaemonManagerLike;
	readonly #sessions = new Map<string, NotebookHostSession>();
	readonly #defaultSaveDirectories = new Map<string, string>();
	readonly #openedFileRelays = new Map<string, OpenedFileRelay>();
	readonly #onNotebookConnected: ElectronNotebookHostServiceOptions["onNotebookConnected"];
	readonly #onNotebookDisconnected: ElectronNotebookHostServiceOptions["onNotebookDisconnected"];

	constructor(options: ElectronNotebookHostServiceOptions) {
		this.#platform = options.platform;
		this.#onNotebookConnected = options.onNotebookConnected;
		this.#onNotebookDisconnected = options.onNotebookDisconnected;
		this.#socketPath =
			options.socketPath ??
			resolveDaemonSocketPath({ channel: options.runtimeChannel ?? "stable" });
		const createDaemonManager =
			options.createDaemonManager ??
			((managerOptions) => new RuntimedDaemonManager(managerOptions));
		// Authenticate whatever answers the daemon socket before any notebook
		// code reaches it: our spawned child by pid, or an attached daemon by its
		// executable digest or verified macOS signing identity.
		const authenticatePeer = createDaemonPeerAuthenticator({
			resolvePeerIdentity: options.resolvePeerIdentity ?? resolveDaemonPeerIdentity,
			allowedExecutableSha256: options.runtimedBinaryPath
				? [findRuntimedArtifact()?.sha256].filter((digest): digest is string => !!digest)
				: [],
			selfUid: typeof process.getuid === "function" ? process.getuid() : null,
		});
		// Warn loudly if the native peer-credential backend cannot load:
		// authentication would then deny every daemon, which is otherwise
		// indistinguishable from a broken runtime. This is an explicit probe
		// (defaulting to the real koffi check) rather than being keyed off the
		// resolvePeerIdentity test seam; tests pass a stub to stay hermetic.
		const probePeerCredentialBackend =
			options.probePeerCredentialBackend ?? isPeerCredentialBackendAvailable;
		void probePeerCredentialBackend()
			.then((available) => {
				if (!available) {
					this.#platform.logger.warn(
						"The notebook runtime daemon cannot be authenticated: the native peer-credential backend (koffi) failed to load, so every daemon will be treated as untrusted. In packaged builds this usually means koffi's native addon was not unpacked from the app bundle.",
					);
				}
			})
			.catch(() => {});
		this.#daemonManager = createDaemonManager({
			binaryPath: options.runtimedBinaryPath,
			socketPath: this.#socketPath,
			allowSpawn: options.socketPath === undefined && !process.env["RUNTIMED_SOCKET_PATH"]?.trim(),
			probe: async () => (await queryDaemonInfo({ socketPath: this.#socketPath })) !== null,
			authenticatePeer,
			logger: this.#platform.logger,
		});
	}

	get socketPath(): string {
		return this.#socketPath;
	}

	start(): Promise<RuntimedDaemonState> {
		return this.#daemonManager.ensureAvailable();
	}

	async status() {
		const daemonProcess = await this.start();
		// Only a daemon that passed authentication (external/bundled) may be
		// reported "available", and only then is its metadata read. A squatter
		// that answers the socket still responds to queryDaemonInfo, so gating on
		// the authenticated process state keeps its version/socket/blob port from
		// reaching the renderer as if it were the real daemon.
		const trusted = daemonProcess.status === "external" || daemonProcess.status === "bundled";
		const daemon = trusted ? await queryDaemonInfo({ socketPath: this.#socketPath }) : null;
		return daemon
			? {
					availability: { status: "available" as const },
					process: daemonProcess,
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
							daemonProcess.status === "failed"
								? daemonProcess.reason
								: "The notebook runtime daemon is not ready yet.",
					},
					process: daemonProcess,
					daemon: null,
				};
	}

	async openFile(requestedPath: string): Promise<NotebookOpenFileResult> {
		if (!path.isAbsolute(requestedPath)) {
			throw new KernelError("VALIDATION", "Notebook paths must be absolute.");
		}
		if (path.extname(requestedPath).toLowerCase() !== ".ipynb") {
			throw new KernelError("VALIDATION", "Notebook files must use the .ipynb extension.");
		}

		let notebookPath: string;
		try {
			notebookPath = await realpath(requestedPath);
			const file = await stat(notebookPath);
			if (!file.isFile()) {
				throw new KernelError("VALIDATION", "The notebook path does not point to a file.");
			}
		} catch (error) {
			if (error instanceof KernelError) throw error;
			throw new KernelError("NOT_FOUND", `Notebook file not found: ${requestedPath}`);
		}

		const daemonState = await this.start();
		if (daemonState.status !== "external" && daemonState.status !== "bundled") {
			throw new KernelError(
				"BUSINESS",
				"reason" in daemonState
					? daemonState.reason
					: "The notebook runtime daemon is unavailable.",
			);
		}

		let relay: RelaySession;
		try {
			relay = await openRelayPath(notebookPath, {
				socketPath: this.#socketPath,
				peerLabel: "kilo-desktop:open-file",
				description: path.basename(notebookPath),
			});
		} catch (error) {
			throw new KernelError(
				"BUSINESS",
				`Could not open notebook: ${error instanceof Error ? error.message : String(error)}`,
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
		port: ElectronMainPort,
		args: ElectronNotebookConnectionArgs,
		windowId: string,
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
				peerLabel: `kilo-desktop:${args.workSessionId}`,
				description: args.title,
			};
			return args.notebookPath
				? openRelayPath(args.notebookPath, relayOptions)
				: createRelay({
						notebookId: args.notebookId,
						ephemeral: false,
						packageManager: "conda",
						...(args.workingDirectory ? { workingDir: args.workingDirectory } : {}),
						...relayOptions,
					});
		};
		const relay = new ReconnectableRelay(await createSession());
		const session: NotebookHostSession = {
			notebookId: args.notebookId,
			workSessionId: args.workSessionId,
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
				handler: this.#handler(session, windowId, reconnect),
			});
			const connectedServer = server;
			session.server = connectedServer;
			unlistenFocus = this.#platform.host?.window.onFocusChange(windowId, (focused) => {
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
					this.#onNotebookDisconnected?.(session.notebookId);
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
				this.#platform.host?.window.isFocused(windowId) ?? true,
			);
			this.#emitDirty(session);
			this.#onNotebookConnected?.({
				notebookId: session.notebookId,
				untitled: !args.notebookPath,
			});
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
		windowId: string,
		reconnect: () => Promise<void>,
	): ElectronNotebookHostHandler {
		const host = this.#platform.host;
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
					return checkTyposquats(typosquatCheckPackages(params));
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
					throw new Error("Opening a notebook outside its Kilo Desktop side panel is unavailable.");
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
					return host.dialog.openFile(windowId, normalizeDialogOptions(params));
				case "dialog.saveFile": {
					if (!host) {
						this.#settleSave(session, { outcome: "cancelled" });
						return null;
					}
					this.#pauseSaveTimeout(session);
					const selectedPath = await host.dialog.saveFile(windowId, normalizeDialogOptions(params));
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
				this.#platform.logger[level](params.message);
			},
		};
	}

	#emitDirty(session: NotebookHostSession): void {
		this.#platform.events.emit("dirty-changed", {
			notebookId: session.notebookId,
			workSessionId: session.workSessionId,
			dirty: session.dirty,
		});
	}

	#updateTitle(session: NotebookHostSession, title: string): void {
		if (!title || session.title === title) return;
		session.title = title;
		this.#platform.events.emit("title-changed", {
			notebookId: session.notebookId,
			workSessionId: session.workSessionId,
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
