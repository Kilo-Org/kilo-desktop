import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";

import type {
	ElectronNotebookHostHandler,
	ElectronNotebookHostServer,
} from "@runtimed/node/electron";
import type { RelayInfo, RelaySession } from "@runtimed/node/relay";

import { findRuntimedArtifact } from "../../packaging/artifacts";

const mocks = vi.hoisted(() => ({
	createRelay: vi.fn(),
	openRelayPath: vi.fn(),
	queryDaemonInfo: vi.fn(),
	serve: vi.fn(),
	// Peer authentication is unit-tested in daemon-peer-auth / -authenticator /
	// RuntimedDaemonManager specs; here it defaults to trusting so these
	// lifecycle tests exercise daemon states without the OS credential lookup.
	createAuthenticator: vi.fn(() => async () => ({ trusted: true }) as const),
}));

vi.mock("@runtimed/node/relay", () => ({
	createRelay: mocks.createRelay,
	openRelayPath: mocks.openRelayPath,
	queryDaemonInfo: mocks.queryDaemonInfo,
}));
vi.mock("@runtimed/node/electron", () => ({
	serveElectronNotebookHost: mocks.serve,
}));
vi.mock("./daemon-peer-authenticator", () => ({
	createDaemonPeerAuthenticator: mocks.createAuthenticator,
}));

import {
	ElectronNotebookHostService,
	type NotebookHostPlatform,
} from "./ElectronNotebookHostService";

type FakeHost = NonNullable<NotebookHostPlatform["host"]>;

/** The platform the service runs on: a logger, an optional desktop host, and recorded events. */
function fakePlatform(
	options: {
		host?: Omit<FakeHost, "window"> & {
			window: Pick<FakeHost["window"], "isFocused" | "onFocusChange"> & Record<string, unknown>;
		};
		logger?: NotebookHostPlatform["logger"];
	} = {},
) {
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	return {
		logger: options.logger ?? { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		...(options.host ? { host: options.host } : {}),
		events: {
			emit: (event: string, payload: unknown) => {
				for (const listener of listeners.get(event) ?? []) listener(payload);
			},
			on: (event: string, listener: (payload: unknown) => void) => {
				listeners.set(event, new Set([...(listeners.get(event) ?? []), listener]));
			},
		},
	} as NotebookHostPlatform & {
		events: { on(event: string, listener: (payload: unknown) => void): void };
	};
}

function relay(
	notebookId: string,
	notebookPath?: string,
	keyedDocKinds: string[] = [],
): RelaySession {
	const info: RelayInfo = {
		notebookId,
		keyedDocKinds,
		commentsNotebookRef: null,
		protocol: "runtimed",
		protocolVersion: 7,
		daemonVersion: "2.6.3",
		socketPath: "/tmp/nightly.sock",
		blobPort: 48637,
		isDevMode: false,
		...(notebookPath ? { notebookPath } : {}),
	};
	return {
		notebookId,
		info,
		closed: false,
		send: vi.fn(async () => undefined),
		onFrame: vi.fn(() => () => undefined),
		onClose: vi.fn(() => () => undefined),
		close: vi.fn(async () => undefined),
	};
}

function port() {
	return {
		postMessage: vi.fn(),
		on: vi.fn().mockReturnThis(),
		off: vi.fn().mockReturnThis(),
		start: vi.fn(),
		close: vi.fn(),
	};
}

function desktopHost(overrides?: {
	openFile?: () => Promise<string | null>;
	saveFile?: () => Promise<string | null>;
	openLink?: (url: string) => Promise<boolean>;
}) {
	return {
		paths: { defaultSaveDirectory: () => "/Users/test/Documents" },
		dialog: {
			openFile: vi.fn(overrides?.openFile ?? (async () => null)),
			saveFile: vi.fn(overrides?.saveFile ?? (async () => null)),
		},
		externalLinks: { open: vi.fn(overrides?.openLink ?? (async () => true)) },
		window: {
			getTitle: () => "Kilo",
			setTitle: vi.fn(),
			isFocused: () => true,
			onFocusChange: (_windowId: string, _listener: (focused: boolean) => void) => () => undefined,
		},
	};
}

describe("ElectronNotebookHostService", () => {
	afterEach(() => vi.unstubAllEnvs());

	it.each(["option", "environment"])(
		"keeps an explicit %s endpoint attach-only",
		async (selection) => {
			mocks.queryDaemonInfo.mockResolvedValue(null);
			const socketPath = path.join(os.tmpdir(), `kd-absent-${process.pid}-${selection}.sock`);
			if (selection === "environment") vi.stubEnv("RUNTIMED_SOCKET_PATH", socketPath);
			const service = new ElectronNotebookHostService({
				platform: fakePlatform(),
				runtimedBinaryPath: "/missing-bundled-runtime",
				...(selection === "option" ? { socketPath } : {}),
			});
			try {
				expect(service.socketPath).toBe(socketPath);
				expect(await service.start()).toMatchObject({
					status: "failed",
					reason: expect.stringContaining("selected notebook runtime"),
				});
			} finally {
				await service.dispose();
			}
		},
	);

	let handler!: ElectronNotebookHostHandler;
	let server: ElectronNotebookHostServer;

	beforeEach(() => {
		vi.clearAllMocks();
		server = { emit: vi.fn(), close: vi.fn(async () => undefined) };
		mocks.serve.mockImplementation((options: { handler: ElectronNotebookHostHandler }) => {
			handler = options.handler;
			return server;
		});
		mocks.createRelay.mockResolvedValue(relay("669d39ec-39d6-4160-815c-b46e170cde8d"));
		mocks.openRelayPath.mockResolvedValue(
			relay("669d39ec-39d6-4160-815c-b46e170cde8d", "/tmp/analysis.ipynb"),
		);
		mocks.queryDaemonInfo.mockResolvedValue({
			version: "2.6.3",
			socketPath: "/tmp/nightly.sock",
			isDevMode: false,
			blobPort: 48637,
		});
	});

	it("connects a scoped peer to the external singleton and announces the daemon ready", async () => {
		const platform = fakePlatform();
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/nightly.sock" });
		const hostPort = port();

		await service.connect(
			hostPort,
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
				workingDirectory: "/projects/analysis",
			},
			"42",
		);

		expect(mocks.createRelay).toHaveBeenCalledWith({
			notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
			ephemeral: false,
			packageManager: "conda",
			workingDir: "/projects/analysis",
			socketPath: "/tmp/nightly.sock",
			peerLabel: "kilo-desktop:kilo-1",
			description: "Analysis",
		});
		expect(mocks.serve).toHaveBeenCalledWith(
			expect.objectContaining({ port: hostPort, handler: expect.any(Object) }),
		);
		expect(server.emit).toHaveBeenCalledWith(
			"daemon.ready",
			expect.objectContaining({ notebook_id: "669d39ec-39d6-4160-815c-b46e170cde8d" }),
		);
		expect(vi.mocked(server.emit).mock.calls[0]?.[1]).not.toHaveProperty("keyed_doc_kinds");
	});

	it("forwards the keyed document kinds the room routes in the ready payload", async () => {
		mocks.createRelay.mockResolvedValueOnce(
			relay("669d39ec-39d6-4160-815c-b46e170cde8d", undefined, ["bokeh_session"]),
		);
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
		});

		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"42",
		);

		expect(server.emit).toHaveBeenCalledWith(
			"daemon.ready",
			expect.objectContaining({ keyed_doc_kinds: ["bokeh_session"] }),
		);
	});

	it("opens a file-backed relay by canonical path and returns the daemon notebook id", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-notebook-"));
		const notebookPath = path.join(directory, "analysis.ipynb");
		await writeFile(notebookPath, '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}');
		const canonicalNotebookPath = await realpath(notebookPath);
		const nativeRelay = relay("669d39ec-39d6-4160-815c-b46e170cde8d", canonicalNotebookPath);
		mocks.openRelayPath.mockResolvedValueOnce(nativeRelay);
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
		});

		try {
			await expect(service.openFile(notebookPath)).resolves.toEqual({
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				path: canonicalNotebookPath,
				title: "analysis.ipynb",
			});
			expect(mocks.openRelayPath).toHaveBeenCalledWith(canonicalNotebookPath, {
				socketPath: "/tmp/nightly.sock",
				peerLabel: "kilo-desktop:open-file",
				description: "analysis.ipynb",
			});
			expect(nativeRelay.close).not.toHaveBeenCalled();
		} finally {
			await service.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("hands the opened-file relay to a matching notebook connection", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-notebook-"));
		const notebookPath = path.join(directory, "analysis.ipynb");
		await writeFile(notebookPath, '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}');
		const canonicalNotebookPath = await realpath(notebookPath);
		const nativeRelay = relay("669d39ec-39d6-4160-815c-b46e170cde8d", canonicalNotebookPath);
		mocks.openRelayPath.mockResolvedValueOnce(nativeRelay);
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
		});

		try {
			await service.openFile(notebookPath);
			await service.connect(
				port(),
				{
					notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
					workSessionId: "kilo-1",
					title: "analysis.ipynb",
					notebookPath: canonicalNotebookPath,
				},
				"42",
			);

			expect(mocks.openRelayPath).toHaveBeenCalledOnce();
			expect(mocks.createRelay).not.toHaveBeenCalled();
			expect(nativeRelay.close).not.toHaveBeenCalled();
			expect(mocks.serve).toHaveBeenCalledWith(
				expect.objectContaining({ port: expect.any(Object), handler: expect.any(Object) }),
			);
		} finally {
			await service.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("closes a previous pending opened-file relay when the same notebook is opened again", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-notebook-"));
		const notebookPath = path.join(directory, "analysis.ipynb");
		await writeFile(notebookPath, '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}');
		const canonicalNotebookPath = await realpath(notebookPath);
		const firstRelay = relay("669d39ec-39d6-4160-815c-b46e170cde8d", canonicalNotebookPath);
		const secondRelay = relay("669d39ec-39d6-4160-815c-b46e170cde8d", canonicalNotebookPath);
		mocks.openRelayPath.mockResolvedValueOnce(firstRelay).mockResolvedValueOnce(secondRelay);
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
		});

		try {
			await service.openFile(notebookPath);
			await service.openFile(notebookPath);
			expect(firstRelay.close).toHaveBeenCalledOnce();
			expect(secondRelay.close).not.toHaveBeenCalled();
		} finally {
			await service.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("closes an unused opened-file relay after the handoff timeout", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-notebook-"));
		const notebookPath = path.join(directory, "analysis.ipynb");
		await writeFile(notebookPath, '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}');
		const canonicalNotebookPath = await realpath(notebookPath);
		const nativeRelay = relay("669d39ec-39d6-4160-815c-b46e170cde8d", canonicalNotebookPath);
		mocks.openRelayPath.mockResolvedValueOnce(nativeRelay);
		vi.useFakeTimers();
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
		});

		try {
			await service.openFile(notebookPath);
			expect(nativeRelay.close).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(30_000);
			expect(nativeRelay.close).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
			await service.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("rejects relative, non-notebook, and unreadable open-file paths", async () => {
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
		});
		await expect(service.openFile("analysis.ipynb")).rejects.toThrow(/must be absolute/);
		await expect(service.openFile("/tmp/notes.txt")).rejects.toThrow(/\.ipynb extension/);
		await expect(service.openFile("/tmp/missing-notebook.ipynb")).rejects.toThrow(/not found/);
	});

	it("wraps native open-file relay failures", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-notebook-"));
		const notebookPath = path.join(directory, "analysis.ipynb");
		await writeFile(notebookPath, '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}');
		mocks.openRelayPath.mockRejectedValueOnce(new Error("lock held"));
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
		});
		try {
			await expect(service.openFile(notebookPath)).rejects.toThrow(
				/Could not open notebook: lock held/,
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("closes a previous host session when the same notebook reconnects", async () => {
		const previous = { emit: vi.fn(), close: vi.fn(async () => undefined) };
		const next = { emit: vi.fn(), close: vi.fn(async () => undefined) };
		mocks.serve.mockReturnValueOnce(previous).mockReturnValueOnce(next);
		const service = new ElectronNotebookHostService({
			platform: fakePlatform({ host: desktopHost() }),
			socketPath: "/tmp/nightly.sock",
		});
		const args = {
			notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
			workSessionId: "kilo-1",
			title: "Analysis",
		};
		await service.connect(port(), args, "91");
		await service.connect(port(), args, "91");
		expect(previous.close).toHaveBeenCalledOnce();
	});

	it("forwards window focus changes and settles a save when the port closes", async () => {
		const listeners = new Map<string, () => void>();
		const hostPort = {
			...port(),
			on: vi.fn((event: string, listener: () => void) => {
				listeners.set(event, listener);
				return hostPort;
			}),
			off: vi.fn().mockReturnThis(),
		};
		let onFocus: ((focused: boolean) => void) | undefined;
		const host = desktopHost();
		host.window.onFocusChange = (_windowId, listener) => {
			onFocus = listener;
			return () => undefined;
		};
		const service = new ElectronNotebookHostService({
			platform: fakePlatform({ host }),
			socketPath: "/tmp/nightly.sock",
		});
		const notebookId = "669d39ec-39d6-4160-815c-b46e170cde8d";
		await service.connect(
			hostPort,
			{ notebookId, workSessionId: "kilo-1", title: "Analysis" },
			"91",
		);
		onFocus?.(false);
		expect(server.emit).toHaveBeenCalledWith("window.focusChanged", false);

		const result = service.save(notebookId);
		listeners.get("close")?.();
		listeners.get("close")?.();
		await expect(result).resolves.toEqual({
			outcome: "failed",
			reason: "The notebook was closed before saving completed.",
		});
	});

	it("connects restored file tabs through their persisted notebook path", async () => {
		const platform = fakePlatform();
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/nightly.sock" });

		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "analysis.ipynb",
				notebookPath: "/tmp/analysis.ipynb",
			},
			"42",
		);

		expect(mocks.openRelayPath).toHaveBeenCalledWith("/tmp/analysis.ipynb", {
			socketPath: "/tmp/nightly.sock",
			peerLabel: "kilo-desktop:kilo-1",
			description: "analysis.ipynb",
		});
		expect(mocks.createRelay).not.toHaveBeenCalled();
		expect(server.emit).toHaveBeenCalledWith(
			"daemon.ready",
			expect.objectContaining({ notebook_path: "/tmp/analysis.ipynb" }),
		);
	});

	it("publishes notebook dirty state without changing the application window title", async () => {
		const setTitle = vi.fn();
		const platform = fakePlatform({
			host: {
				paths: { defaultSaveDirectory: () => "/tmp" },
				dialog: {
					openFile: vi.fn(async () => null),
					saveFile: vi.fn(async () => null),
				},
				externalLinks: { open: vi.fn(async () => true) },
				window: {
					getTitle: () => "Kilo",
					setTitle,
					isFocused: () => true,
					onFocusChange: () => () => undefined,
				},
			},
		});
		const dirtyChanged = vi.fn();
		platform.events.on("dirty-changed", dirtyChanged);
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/runtime.sock" });

		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);
		await handler.invoke("window.setTitle", { title: "Analysis" });
		await handler.invoke("window.setTitle", { title: "* Analysis" });

		expect(dirtyChanged).toHaveBeenCalledWith({
			notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
			workSessionId: "kilo-1",
			dirty: false,
		});
		expect(dirtyChanged).toHaveBeenLastCalledWith({
			notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
			workSessionId: "kilo-1",
			dirty: true,
		});
		expect(setTitle).not.toHaveBeenCalled();
		await expect(handler.invoke("window.getTitle", undefined)).resolves.toBe("Analysis");
	});

	it("routes Save through nteract and resolves after Save As applies its path", async () => {
		const saveFile = vi.fn(async () => "/tmp/analysis.ipynb");
		const platform = fakePlatform({
			host: {
				paths: { defaultSaveDirectory: () => "/tmp" },
				dialog: { openFile: vi.fn(async () => null), saveFile },
				externalLinks: { open: vi.fn(async () => true) },
				window: {
					getTitle: () => "Kilo",
					setTitle: vi.fn(),
					isFocused: () => true,
					onFocusChange: () => () => undefined,
				},
			},
		});
		const titleChanged = vi.fn();
		platform.events.on("title-changed", titleChanged);
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/runtime.sock" });
		const notebookId = "669d39ec-39d6-4160-815c-b46e170cde8d";
		await service.connect(port(), { notebookId, workSessionId: "kilo-1", title: "Analysis" }, "91");

		const result = service.save(notebookId);
		expect(server.emit).toHaveBeenCalledWith("command", {
			id: "notebook.save",
			payload: undefined,
		});
		await handler.invoke("dialog.saveFile", { defaultPath: "/tmp/analysis.ipynb" });
		await handler.invoke("notebook.applyPathChanged", { path: "/tmp/analysis.ipynb" });

		await expect(result).resolves.toEqual({ outcome: "saved" });
		expect(titleChanged).toHaveBeenCalledWith({
			notebookId,
			workSessionId: "kilo-1",
			title: "analysis.ipynb",
		});
		await expect(handler.invoke("window.getTitle", undefined)).resolves.toBe("analysis.ipynb");
	});

	it("keeps a dirty tab open when the Save As dialog is cancelled", async () => {
		const platform = fakePlatform({
			host: {
				paths: { defaultSaveDirectory: () => "/tmp" },
				dialog: {
					openFile: vi.fn(async () => null),
					saveFile: vi.fn(async () => null),
				},
				externalLinks: { open: vi.fn(async () => true) },
				window: {
					getTitle: () => "Kilo",
					setTitle: vi.fn(),
					isFocused: () => true,
					onFocusChange: () => () => undefined,
				},
			},
		});
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/runtime.sock" });
		const notebookId = "669d39ec-39d6-4160-815c-b46e170cde8d";
		await service.connect(port(), { notebookId, workSessionId: "kilo-1", title: "Analysis" }, "91");

		const result = service.save(notebookId);
		await handler.invoke("dialog.saveFile", { defaultPath: "/tmp/analysis.ipynb" });

		await expect(result).resolves.toEqual({ outcome: "cancelled" });
	});

	it("reports a failed save when the notebook session is not connected", async () => {
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/runtime.sock",
		});

		await expect(service.save("669d39ec-39d6-4160-815c-b46e170cde8d")).resolves.toEqual({
			outcome: "failed",
			reason: "The notebook is not connected.",
		});
	});

	it("preserves bootstrap frames emitted before the Electron server subscribes", async () => {
		const first = relay("669d39ec-39d6-4160-815c-b46e170cde8d");
		const bootstrap = new Uint8Array([0, 1, 2, 3]);
		first.onFrame = vi.fn((listener) => {
			listener(bootstrap);
			return () => undefined;
		});
		mocks.createRelay.mockResolvedValueOnce(first);
		let delivered: Uint8Array | undefined;
		mocks.serve.mockImplementation(
			(options: { handler: ElectronNotebookHostHandler; relay: RelaySession }) => {
				handler = options.handler;
				options.relay.onFrame((frame) => {
					delivered = frame;
				});
				return server;
			},
		);

		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
		});
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"42",
		);

		expect(delivered).toEqual(bootstrap);
	});

	it("closes the native relay if Electron host setup fails", async () => {
		const nativeRelay = relay("669d39ec-39d6-4160-815c-b46e170cde8d");
		mocks.createRelay.mockResolvedValueOnce(nativeRelay);
		mocks.serve.mockImplementationOnce(() => {
			throw new Error("MessagePort setup failed");
		});
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
		});

		await expect(
			service.connect(
				port(),
				{
					notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
					workSessionId: "kilo-1",
					title: "Analysis",
				},
				"42",
			),
		).rejects.toThrow("MessagePort setup failed");
		expect(nativeRelay.close).toHaveBeenCalledOnce();
	});

	it("delegates native save dialogs to the sender-owned window", async () => {
		const saveFile = vi.fn(async () => "/tmp/analysis.ipynb");
		const platform = fakePlatform({
			host: {
				paths: { defaultSaveDirectory: () => "/Users/test/Documents" },
				dialog: { openFile: vi.fn(async () => null), saveFile },
				externalLinks: { open: vi.fn(async () => true) },
				window: {
					getTitle: () => "Analysis",
					setTitle: vi.fn(),
					isFocused: () => true,
					onFocusChange: () => () => undefined,
				},
			},
		});
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/runtime.sock" });
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		await expect(
			handler.invoke("dialog.saveFile", {
				defaultPath: "/tmp/analysis.ipynb",
				filters: [{ name: "Notebook", extensions: ["ipynb"] }],
			}),
		).resolves.toBe("/tmp/analysis.ipynb");
		expect(saveFile).toHaveBeenCalledWith("91", {
			defaultPath: "/tmp/analysis.ipynb",
			filters: [{ name: "Notebook", extensions: ["ipynb"] }],
		});
	});

	it("uses the connected chat workspace as nteract's default save directory", async () => {
		const platform = fakePlatform({
			host: {
				paths: { defaultSaveDirectory: () => "/Users/test/Documents" },
				dialog: {
					openFile: vi.fn(async () => null),
					saveFile: vi.fn(async () => null),
				},
				externalLinks: { open: vi.fn(async () => true) },
				window: {
					getTitle: () => "Analysis",
					setTitle: vi.fn(),
					isFocused: () => true,
					onFocusChange: () => () => undefined,
				},
			},
		});
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/runtime.sock" });
		service.setDefaultSaveDirectory("669d39ec-39d6-4160-815c-b46e170cde8d", "/projects/analysis");
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		await expect(handler.invoke("notebook.getDefaultSaveDirectory", undefined)).resolves.toBe(
			"/projects/analysis",
		);

		service.setDefaultSaveDirectory("669d39ec-39d6-4160-815c-b46e170cde8d", "/projects/updated");
		await expect(handler.invoke("notebook.getDefaultSaveDirectory", undefined)).resolves.toBe(
			"/projects/updated",
		);
	});

	it("falls back to Documents when the chat has no workspace", async () => {
		const platform = fakePlatform({
			host: {
				paths: { defaultSaveDirectory: () => "/Users/test/Documents" },
				dialog: {
					openFile: vi.fn(async () => null),
					saveFile: vi.fn(async () => null),
				},
				externalLinks: { open: vi.fn(async () => true) },
				window: {
					getTitle: () => "Analysis",
					setTitle: vi.fn(),
					isFocused: () => true,
					onFocusChange: () => () => undefined,
				},
			},
		});
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/runtime.sock" });
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		await expect(handler.invoke("notebook.getDefaultSaveDirectory", undefined)).resolves.toBe(
			"/Users/test/Documents",
		);
	});

	it("replaces the native relay when nteract requests reconnect", async () => {
		const first = relay("669d39ec-39d6-4160-815c-b46e170cde8d");
		const second = relay("669d39ec-39d6-4160-815c-b46e170cde8d");
		mocks.createRelay.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
		const platform = fakePlatform();
		const service = new ElectronNotebookHostService({ platform });
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"42",
		);

		await handler.invoke("daemon.reconnect", { force: true });

		expect(mocks.createRelay).toHaveBeenCalledTimes(2);
		expect(mocks.createRelay).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				ephemeral: false,
			}),
		);
		expect(first.close).toHaveBeenCalledOnce();
		expect(server.emit).toHaveBeenCalledWith("transport.status", "reconnecting");
		expect(server.emit).toHaveBeenCalledWith("transport.status", "online");
	});

	it("reports an actionable failure when the selected daemon is unavailable", async () => {
		mocks.queryDaemonInfo.mockResolvedValue(null);
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/runtimed-nightly.sock",
		});

		await expect(service.status()).resolves.toEqual({
			availability: {
				status: "unavailable",
				reason: expect.stringContaining("selected notebook runtime"),
			},
			process: {
				status: "failed",
				reason: expect.stringContaining("selected notebook runtime"),
			},
			daemon: null,
		});
		expect(mocks.createRelay).not.toHaveBeenCalled();
	});

	it("never reports an untrusted daemon as available or leaks its metadata", async () => {
		// A squatter answers the socket, so queryDaemonInfo would succeed, but the
		// daemon manager failed authentication. status() must stay unavailable and
		// must not surface the attacker-controlled version/socket/blob port.
		mocks.queryDaemonInfo.mockResolvedValue({
			version: "6.6.6",
			socketPath: "/tmp/squatter.sock",
			isDevMode: false,
			blobPort: 1337,
		});
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
			createDaemonManager: () => ({
				state: { status: "idle" },
				ensureAvailable: async () => ({
					status: "failed" as const,
					reason: "The runtime daemon is running an untrusted executable: /tmp/evil.",
				}),
				dispose: async () => undefined,
			}),
		});

		const result = await service.status();
		expect(result.availability).toEqual({
			status: "unavailable",
			reason: expect.stringContaining("untrusted executable"),
		});
		expect(result.daemon).toBeNull();
		expect(mocks.queryDaemonInfo).not.toHaveBeenCalled();
	});

	it("can warm the daemon without opening a notebook relay", async () => {
		const ensureAvailable = vi.fn(async () => ({ status: "bundled" as const, pid: 42 }));
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			createDaemonManager: () => ({
				state: { status: "idle" },
				ensureAvailable,
				dispose: async () => undefined,
			}),
		});

		await expect(service.start()).resolves.toEqual({ status: "bundled", pid: 42 });
		expect(ensureAvailable).toHaveBeenCalledOnce();
		expect(mocks.createRelay).not.toHaveBeenCalled();
	});

	it("starts the bundled daemon before opening a relay", async () => {
		const ensureAvailable = vi.fn(async () => ({ status: "bundled" as const, pid: 42 }));
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/runtimed-nightly.sock",
			runtimedBinaryPath: "/resources/runtimed-nightly",
			createDaemonManager: () => ({
				state: { status: "idle" },
				ensureAvailable,
				dispose: async () => undefined,
			}),
		});

		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"42",
		);

		expect(ensureAvailable).toHaveBeenCalledOnce();
		expect(mocks.createRelay).toHaveBeenCalledOnce();
	});

	it("answers sidecar protocol methods for daemon, blobs, and settings", async () => {
		const platform = fakePlatform({ host: desktopHost() });
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/nightly.sock" });
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		await expect(handler.invoke("daemon.isConnected", undefined)).resolves.toBe(true);
		await expect(handler.invoke("daemon.getInfo", undefined)).resolves.toEqual({
			version: "2.6.3",
			socket_path: "/tmp/nightly.sock",
			is_dev_mode: false,
		});
		await expect(handler.invoke("daemon.getReadyInfo", undefined)).resolves.toEqual(
			expect.objectContaining({ notebook_id: "669d39ec-39d6-4160-815c-b46e170cde8d" }),
		);
		await expect(handler.invoke("blobs.getPort", undefined)).resolves.toBe(48637);
		await expect(
			handler.invoke("deps.checkTyposquats", { packages: ["numpy", "conda-forge::numppy>=1"] }),
		).resolves.toEqual([{ package: "numppy", similar_to: "numpy", distance: 1 }]);
		for (const invalid of [
			undefined,
			{ packages: "numpy" },
			{ packages: [1] },
			{ packages: ["x".repeat(513)] },
			{ packages: Array.from({ length: 501 }, () => "numpy") },
		]) {
			await expect(handler.invoke("deps.checkTyposquats", invalid as never)).rejects.toThrow(
				/requires packages: string\[\]/,
			);
		}
		await expect(handler.invoke("relay.prepareSync", { generation: 1 })).resolves.toBeUndefined();
		await expect(
			handler.invoke("relay.notifySyncReady", { generation: 1 }),
		).resolves.toBeUndefined();
		await expect(handler.invoke("window.setTheme", { theme: "dark" })).resolves.toBeUndefined();
		await expect(handler.invoke("settings.openWindow", undefined)).resolves.toBeUndefined();
		await expect(
			handler.invoke("settings.setSynced", { key: "a", value: 1 }),
		).resolves.toBeUndefined();
		await expect(handler.invoke("updater.beginUpgrade", undefined)).resolves.toBeUndefined();
		await expect(handler.invoke("updater.check", undefined)).resolves.toEqual({
			status: "idle",
			version: null,
			error: null,
		});
		await expect(handler.invoke("settings.getSynced", undefined)).resolves.toEqual({});
		await expect(handler.invoke("settings.rotateInstallId", undefined)).resolves.toEqual(
			expect.any(String),
		);
		await expect(handler.invoke("system.getGitInfo", undefined)).resolves.toBeNull();
		await expect(handler.invoke("system.getUsername", undefined)).resolves.toBe(
			os.userInfo().username,
		);
		await expect(handler.invoke("system.getFontFamilies", undefined)).resolves.toEqual([]);
	});

	it("rejects opening or cloning notebooks outside the Kilo Desktop side panel", async () => {
		const platform = fakePlatform({ host: desktopHost() });
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/nightly.sock" });
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		await expect(
			handler.invoke("notebook.openInNewWindow", { path: "/tmp/a.ipynb" }),
		).rejects.toThrow(/Opening a notebook outside its Kilo Desktop side panel is unavailable/);
		await expect(
			handler.invoke("notebook.openHostedInNewWindow", { url: "https://example.test" }),
		).rejects.toThrow(/Opening a notebook outside its Kilo Desktop side panel is unavailable/);
		await expect(handler.invoke("notebook.cloneToEphemeral", undefined)).rejects.toThrow(
			/Cloning the sidecar notebook is not supported/,
		);
	});

	it("rejects an unsupported host method", async () => {
		const platform = fakePlatform({ host: desktopHost() });
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/nightly.sock" });
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		await expect(
			handler.invoke("totally.not.a.method" as never, undefined as never),
		).rejects.toThrow(/Unsupported Electron notebook host method/);
	});

	it("opens files and external links through the desktop host", async () => {
		const openFile = vi.fn(async () => "/tmp/opened.ipynb");
		const openLink = vi.fn(async () => true);
		const platform = fakePlatform({
			host: desktopHost({ openFile, openLink }),
		});
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/nightly.sock" });
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		await expect(handler.invoke("dialog.openFile", { defaultPath: "/tmp" })).resolves.toBe(
			"/tmp/opened.ipynb",
		);
		expect(openFile).toHaveBeenCalledWith("91", { defaultPath: "/tmp" });
		await expect(
			handler.invoke("externalLinks.open", { url: "https://docs.anaconda.com" }),
		).resolves.toBeUndefined();
		expect(openLink).toHaveBeenCalledWith("https://docs.anaconda.com");
	});

	it("rejects invalid or unauthorized external links", async () => {
		const platform = fakePlatform({
			host: desktopHost({ openLink: async () => false }),
		});
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/nightly.sock" });
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		await expect(handler.invoke("externalLinks.open", { url: 1 as never })).rejects.toThrow(
			/The external URL was rejected by the host/,
		);
		await expect(
			handler.invoke("externalLinks.open", { url: "https://evil.example" }),
		).rejects.toThrow(/The external URL was rejected by the host/);
	});

	it("forwards sidecar log notifications to the feature logger", async () => {
		const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const platform = fakePlatform({
			host: desktopHost(),
			logger,
		});
		const service = new ElectronNotebookHostService({ platform, socketPath: "/tmp/nightly.sock" });
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		handler.notify?.({ method: "log.debug", params: { message: "debug" } });
		handler.notify?.({ method: "log.info", params: { message: "info" } });
		handler.notify?.({ method: "log.warn", params: { message: "warn" } });
		handler.notify?.({ method: "log.error", params: { message: "error" } });

		expect(logger.debug).toHaveBeenCalledWith("debug");
		expect(logger.info).toHaveBeenCalledWith("info");
		expect(logger.warn).toHaveBeenCalledWith("warn");
		expect(logger.error).toHaveBeenCalledWith("error");
	});

	it("cancels Save As when the desktop host has no dialog", async () => {
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
		});
		const notebookId = "669d39ec-39d6-4160-815c-b46e170cde8d";
		await service.connect(port(), { notebookId, workSessionId: "kilo-1", title: "Analysis" }, "91");

		const result = service.save(notebookId);
		await expect(
			handler.invoke("dialog.saveFile", { defaultPath: "/tmp/a.ipynb" }),
		).resolves.toBeNull();
		await expect(result).resolves.toEqual({ outcome: "cancelled" });
	});

	it("closes active sessions when disposed", async () => {
		const service = new ElectronNotebookHostService({
			platform: fakePlatform({ host: desktopHost() }),
			socketPath: "/tmp/nightly.sock",
		});
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		await service.dispose();
		expect(server.close).toHaveBeenCalledOnce();
	});

	it("closes a pending opened-file relay when disposed", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-notebook-"));
		const notebookPath = path.join(directory, "analysis.ipynb");
		await writeFile(notebookPath, '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}');
		const canonicalNotebookPath = await realpath(notebookPath);
		const nativeRelay = relay("669d39ec-39d6-4160-815c-b46e170cde8d", canonicalNotebookPath);
		mocks.openRelayPath.mockResolvedValueOnce(nativeRelay);
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
		});

		try {
			await service.openFile(notebookPath);
			await service.dispose();
			expect(nativeRelay.close).toHaveBeenCalledOnce();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("fails blob-port lookup when the daemon did not advertise one", async () => {
		const native = relay("669d39ec-39d6-4160-815c-b46e170cde8d");
		const { blobPort: _blobPort, ...info } = native.info;
		mocks.createRelay.mockResolvedValueOnce({ ...native, info: info as RelayInfo });
		const service = new ElectronNotebookHostService({
			platform: fakePlatform({ host: desktopHost() }),
			socketPath: "/tmp/nightly.sock",
		});
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		await expect(handler.invoke("blobs.getPort", undefined)).rejects.toThrow(
			/The runtime daemon has no blob server/,
		);
	});

	it("reports an already-clean notebook as saved without prompting", async () => {
		const service = new ElectronNotebookHostService({
			platform: fakePlatform({ host: desktopHost() }),
			socketPath: "/tmp/nightly.sock",
		});
		const notebookId = "669d39ec-39d6-4160-815c-b46e170cde8d";
		await service.connect(
			port(),
			{
				notebookId,
				workSessionId: "kilo-1",
				title: "Analysis",
				notebookPath: "/tmp/analysis.ipynb",
			},
			"91",
		);

		await expect(service.save(notebookId)).resolves.toEqual({ outcome: "saved" });
		expect(server.emit).not.toHaveBeenCalledWith("command", {
			id: "notebook.save",
			payload: undefined,
		});
	});

	it("returns null from open-file when the desktop host is absent", async () => {
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
		});
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		await expect(handler.invoke("dialog.openFile", { defaultPath: "/tmp" })).resolves.toBeNull();
	});

	it("reuses an in-flight save instead of emitting a second command", async () => {
		const service = new ElectronNotebookHostService({
			platform: fakePlatform({ host: desktopHost() }),
			socketPath: "/tmp/nightly.sock",
		});
		const notebookId = "669d39ec-39d6-4160-815c-b46e170cde8d";
		await service.connect(port(), { notebookId, workSessionId: "kilo-1", title: "Analysis" }, "91");

		const first = service.save(notebookId);
		const second = service.save(notebookId);
		expect(second).toBe(first);
		expect(vi.mocked(server.emit).mock.calls.filter(([event]) => event === "command")).toHaveLength(
			1,
		);
		await handler.invoke("window.setTitle", { title: "Analysis" });
		await expect(first).resolves.toEqual({ outcome: "saved" });
		await expect(second).resolves.toEqual({ outcome: "saved" });
	});

	it("fails a save that never receives a completion event", async () => {
		vi.useFakeTimers();
		try {
			const service = new ElectronNotebookHostService({
				platform: fakePlatform({ host: desktopHost() }),
				socketPath: "/tmp/nightly.sock",
			});
			const notebookId = "669d39ec-39d6-4160-815c-b46e170cde8d";
			await service.connect(
				port(),
				{ notebookId, workSessionId: "kilo-1", title: "Analysis" },
				"91",
			);

			const result = service.save(notebookId);
			await vi.advanceTimersByTimeAsync(30_000);
			await expect(result).resolves.toEqual({
				outcome: "failed",
				reason: "The notebook did not confirm the save completed.",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("marks the transport offline when reconnect cannot replace the relay", async () => {
		const service = new ElectronNotebookHostService({
			platform: fakePlatform({ host: desktopHost() }),
			socketPath: "/tmp/nightly.sock",
		});
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);
		mocks.createRelay.mockRejectedValueOnce(new Error("socket down"));

		await expect(handler.invoke("daemon.reconnect", { force: true })).rejects.toThrow(
			"socket down",
		);
		expect(server.emit).toHaveBeenCalledWith("transport.status", "offline");
	});

	it("refuses to connect when the daemon never becomes ready", async () => {
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
			createDaemonManager: () => ({
				state: { status: "failed", reason: "gone" },
				ensureAvailable: async () => ({ status: "failed" as const, reason: "gone" }),
				dispose: async () => undefined,
			}),
		});

		await expect(
			service.connect(
				port(),
				{
					notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
					workSessionId: "kilo-1",
					title: "Analysis",
				},
				"91",
			),
		).rejects.toThrow("gone");
	});

	it("drops malformed save-dialog filters instead of forwarding them", async () => {
		const saveFile = vi.fn(async () => "/tmp/analysis.ipynb");
		const service = new ElectronNotebookHostService({
			platform: fakePlatform({
				host: desktopHost({ saveFile }),
			}),
			socketPath: "/tmp/nightly.sock",
		});
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		await expect(handler.invoke("dialog.saveFile", "not-an-object")).resolves.toBe(
			"/tmp/analysis.ipynb",
		);
		expect(saveFile).toHaveBeenCalledWith("91", undefined);
		await expect(
			handler.invoke("dialog.saveFile", {
				filters: [
					{ name: 1, extensions: ["ipynb"] },
					{ name: "Notebook", extensions: ["ipynb"] },
				],
			}),
		).resolves.toBe("/tmp/analysis.ipynb");
		expect(saveFile).toHaveBeenLastCalledWith("91", {
			filters: [{ name: "Notebook", extensions: ["ipynb"] }],
		});
	});

	it("falls back to the home directory when no default save path is configured", async () => {
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
		});
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				workSessionId: "kilo-1",
				title: "Analysis",
			},
			"91",
		);

		await expect(handler.invoke("notebook.getDefaultSaveDirectory", undefined)).resolves.toBe(
			os.homedir(),
		);
		service.setDefaultSaveDirectory("669d39ec-39d6-4160-815c-b46e170cde8d", "relative");
		await expect(handler.invoke("notebook.getDefaultSaveDirectory", undefined)).resolves.toBe(
			os.homedir(),
		);
	});
});

describe("ElectronNotebookHostService daemon authentication wiring", () => {
	afterEach(() => vi.clearAllMocks());

	it("builds the authenticator from the pinned release, this user's uid, and the resolver seam", async () => {
		const resolvePeerIdentity = vi.fn(async () => null);
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
			runtimedBinaryPath: "/resources/runtimed-nightly",
			resolvePeerIdentity,
			probePeerCredentialBackend: async () => true,
		});

		expect(mocks.createAuthenticator).toHaveBeenCalledWith({
			resolvePeerIdentity,
			allowedExecutableSha256: [findRuntimedArtifact()?.sha256],
			selfUid: typeof process.getuid === "function" ? process.getuid() : null,
		});
		await service.dispose();
	});

	it("trusts no external image when no bundled binary is staged", async () => {
		const service = new ElectronNotebookHostService({
			platform: fakePlatform(),
			socketPath: "/tmp/nightly.sock",
			probePeerCredentialBackend: async () => true,
		});

		expect(mocks.createAuthenticator).toHaveBeenCalledWith(
			expect.objectContaining({ allowedExecutableSha256: [] }),
		);
		await service.dispose();
	});
});
