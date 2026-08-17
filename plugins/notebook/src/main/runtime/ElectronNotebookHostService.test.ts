import { beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";

import type {
	ElectronNotebookHostHandler,
	ElectronNotebookHostServer,
} from "@runtimed/node/electron";
import type { RelayInfo, RelaySession } from "@runtimed/node/relay";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

const mocks = vi.hoisted(() => ({
	createRelay: vi.fn(),
	openRelayPath: vi.fn(),
	queryDaemonInfo: vi.fn(),
	serve: vi.fn(),
}));

vi.mock("@runtimed/node/relay", () => ({
	createRelay: mocks.createRelay,
	openRelayPath: mocks.openRelayPath,
	queryDaemonInfo: mocks.queryDaemonInfo,
}));
vi.mock("@runtimed/node/electron", () => ({
	serveElectronNotebookHost: mocks.serve,
}));

import { ElectronNotebookHostService } from "./ElectronNotebookHostService.js";

function relay(notebookId: string, notebookPath?: string): RelaySession {
	const info: RelayInfo = {
		notebookId,
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

describe("ElectronNotebookHostService", () => {
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

	it("connects a scoped peer to the external singleton and exposes no socket to the renderer", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "notebook" });
		const service = new ElectronNotebookHostService({ mainSdk, socketPath: "/tmp/nightly.sock" });
		const hostPort = port();

		await service.connect(
			hostPort,
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				sessionId: "kilo-1",
				title: "Analysis",
			},
			42,
		);

		expect(mocks.createRelay).toHaveBeenCalledWith({
			notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
			ephemeral: false,
			socketPath: "/tmp/nightly.sock",
			peerLabel: "agentic-desktop:kilo-1",
			description: "Analysis",
		});
		expect(mocks.serve).toHaveBeenCalledWith(
			expect.objectContaining({ port: hostPort, handler: expect.any(Object) }),
		);
		expect(server.emit).toHaveBeenCalledWith(
			"daemon.ready",
			expect.objectContaining({ notebook_id: "669d39ec-39d6-4160-815c-b46e170cde8d" }),
		);
	});

	it("opens a file-backed relay by canonical path and returns the daemon notebook id", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "agentic-notebook-"));
		const notebookPath = path.join(directory, "analysis.ipynb");
		await writeFile(notebookPath, '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}');
		const canonicalNotebookPath = await realpath(notebookPath);
		const nativeRelay = relay("669d39ec-39d6-4160-815c-b46e170cde8d", canonicalNotebookPath);
		mocks.openRelayPath.mockResolvedValueOnce(nativeRelay);
		const service = new ElectronNotebookHostService({
			mainSdk: createFakeMainSdk({ featureId: "notebook" }),
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
				peerLabel: "agentic-desktop:open-file",
				description: "analysis.ipynb",
			});
			expect(nativeRelay.close).toHaveBeenCalledOnce();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("connects restored file tabs through their persisted notebook path", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "notebook" });
		const service = new ElectronNotebookHostService({ mainSdk, socketPath: "/tmp/nightly.sock" });

		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				sessionId: "kilo-1",
				title: "analysis.ipynb",
				notebookPath: "/tmp/analysis.ipynb",
			},
			42,
		);

		expect(mocks.openRelayPath).toHaveBeenCalledWith("/tmp/analysis.ipynb", {
			socketPath: "/tmp/nightly.sock",
			peerLabel: "agentic-desktop:kilo-1",
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
		const mainSdk = createFakeMainSdk({
			featureId: "notebook",
			host: {
				paths: { defaultSaveDirectory: () => "/tmp" },
				dialog: {
					openFile: vi.fn(async () => null),
					saveFile: vi.fn(async () => null),
				},
				externalLinks: { open: vi.fn(async () => true) },
				window: {
					getTitle: () => "Agentic",
					setTitle,
					isFocused: () => true,
					onFocusChange: () => () => undefined,
				},
			},
		});
		const dirtyChanged = vi.fn();
		mainSdk.events.on("notebook.dirty-changed", dirtyChanged);
		const service = new ElectronNotebookHostService({ mainSdk, socketPath: "/tmp/runtime.sock" });

		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				sessionId: "kilo-1",
				title: "Analysis",
			},
			91,
		);
		await handler.invoke("window.setTitle", { title: "Analysis" });
		await handler.invoke("window.setTitle", { title: "* Analysis" });

		expect(dirtyChanged).toHaveBeenCalledWith({
			notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
			sessionId: "kilo-1",
			dirty: false,
		});
		expect(dirtyChanged).toHaveBeenLastCalledWith({
			notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
			sessionId: "kilo-1",
			dirty: true,
		});
		expect(setTitle).not.toHaveBeenCalled();
		await expect(handler.invoke("window.getTitle", undefined)).resolves.toBe("Analysis");
	});

	it("routes Save through nteract and resolves after Save As applies its path", async () => {
		const saveFile = vi.fn(async () => "/tmp/analysis.ipynb");
		const mainSdk = createFakeMainSdk({
			featureId: "notebook",
			host: {
				paths: { defaultSaveDirectory: () => "/tmp" },
				dialog: { openFile: vi.fn(async () => null), saveFile },
				externalLinks: { open: vi.fn(async () => true) },
				window: {
					getTitle: () => "Agentic",
					setTitle: vi.fn(),
					isFocused: () => true,
					onFocusChange: () => () => undefined,
				},
			},
		});
		const titleChanged = vi.fn();
		mainSdk.events.on("notebook.title-changed", titleChanged);
		const service = new ElectronNotebookHostService({ mainSdk, socketPath: "/tmp/runtime.sock" });
		const notebookId = "669d39ec-39d6-4160-815c-b46e170cde8d";
		await service.connect(port(), { notebookId, sessionId: "kilo-1", title: "Analysis" }, 91);

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
			sessionId: "kilo-1",
			title: "analysis.ipynb",
		});
		await expect(handler.invoke("window.getTitle", undefined)).resolves.toBe("analysis.ipynb");
	});

	it("keeps a dirty tab open when the Save As dialog is cancelled", async () => {
		const mainSdk = createFakeMainSdk({
			featureId: "notebook",
			host: {
				paths: { defaultSaveDirectory: () => "/tmp" },
				dialog: {
					openFile: vi.fn(async () => null),
					saveFile: vi.fn(async () => null),
				},
				externalLinks: { open: vi.fn(async () => true) },
				window: {
					getTitle: () => "Agentic",
					setTitle: vi.fn(),
					isFocused: () => true,
					onFocusChange: () => () => undefined,
				},
			},
		});
		const service = new ElectronNotebookHostService({ mainSdk, socketPath: "/tmp/runtime.sock" });
		const notebookId = "669d39ec-39d6-4160-815c-b46e170cde8d";
		await service.connect(port(), { notebookId, sessionId: "kilo-1", title: "Analysis" }, 91);

		const result = service.save(notebookId);
		await handler.invoke("dialog.saveFile", { defaultPath: "/tmp/analysis.ipynb" });

		await expect(result).resolves.toEqual({ outcome: "cancelled" });
	});

	it("reports a failed save when the notebook session is not connected", async () => {
		const service = new ElectronNotebookHostService({
			mainSdk: createFakeMainSdk({ featureId: "notebook" }),
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
			mainSdk: createFakeMainSdk({ featureId: "notebook" }),
			socketPath: "/tmp/nightly.sock",
		});
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				sessionId: "kilo-1",
				title: "Analysis",
			},
			42,
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
			mainSdk: createFakeMainSdk({ featureId: "notebook" }),
			socketPath: "/tmp/nightly.sock",
		});

		await expect(
			service.connect(
				port(),
				{
					notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
					sessionId: "kilo-1",
					title: "Analysis",
				},
				42,
			),
		).rejects.toThrow("MessagePort setup failed");
		expect(nativeRelay.close).toHaveBeenCalledOnce();
	});

	it("delegates native save dialogs to the sender-owned window", async () => {
		const saveFile = vi.fn(async () => "/tmp/analysis.ipynb");
		const mainSdk = createFakeMainSdk({
			featureId: "notebook",
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
		const service = new ElectronNotebookHostService({ mainSdk, socketPath: "/tmp/runtime.sock" });
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				sessionId: "kilo-1",
				title: "Analysis",
			},
			91,
		);

		await expect(
			handler.invoke("dialog.saveFile", {
				defaultPath: "/tmp/analysis.ipynb",
				filters: [{ name: "Notebook", extensions: ["ipynb"] }],
			}),
		).resolves.toBe("/tmp/analysis.ipynb");
		expect(saveFile).toHaveBeenCalledWith(91, {
			defaultPath: "/tmp/analysis.ipynb",
			filters: [{ name: "Notebook", extensions: ["ipynb"] }],
		});
	});

	it("uses the connected chat workspace as nteract's default save directory", async () => {
		const mainSdk = createFakeMainSdk({
			featureId: "notebook",
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
		const service = new ElectronNotebookHostService({ mainSdk, socketPath: "/tmp/runtime.sock" });
		service.setDefaultSaveDirectory("669d39ec-39d6-4160-815c-b46e170cde8d", "/projects/analysis");
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				sessionId: "kilo-1",
				title: "Analysis",
			},
			91,
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
		const mainSdk = createFakeMainSdk({
			featureId: "notebook",
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
		const service = new ElectronNotebookHostService({ mainSdk, socketPath: "/tmp/runtime.sock" });
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				sessionId: "kilo-1",
				title: "Analysis",
			},
			91,
		);

		await expect(handler.invoke("notebook.getDefaultSaveDirectory", undefined)).resolves.toBe(
			"/Users/test/Documents",
		);
	});

	it("replaces the native relay when nteract requests reconnect", async () => {
		const first = relay("669d39ec-39d6-4160-815c-b46e170cde8d");
		const second = relay("669d39ec-39d6-4160-815c-b46e170cde8d");
		mocks.createRelay.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
		const mainSdk = createFakeMainSdk({ featureId: "notebook" });
		const service = new ElectronNotebookHostService({ mainSdk });
		await service.connect(
			port(),
			{
				notebookId: "669d39ec-39d6-4160-815c-b46e170cde8d",
				sessionId: "kilo-1",
				title: "Analysis",
			},
			42,
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

	it("reports an actionable failure when no daemon or bundled binary is available", async () => {
		mocks.queryDaemonInfo.mockResolvedValue(null);
		const service = new ElectronNotebookHostService({
			mainSdk: createFakeMainSdk({ featureId: "notebook" }),
			socketPath: "/tmp/runtimed-nightly.sock",
		});

		await expect(service.status()).resolves.toEqual({
			availability: {
				status: "unavailable",
				reason: "The bundled runtimed daemon is unavailable.",
			},
			process: {
				status: "failed",
				reason: "The bundled runtimed daemon is unavailable.",
			},
			daemon: null,
		});
		expect(mocks.createRelay).not.toHaveBeenCalled();
	});

	it("can warm the daemon without opening a notebook relay", async () => {
		const ensureAvailable = vi.fn(async () => ({ status: "bundled" as const, pid: 42 }));
		const service = new ElectronNotebookHostService({
			mainSdk: createFakeMainSdk({ featureId: "notebook" }),
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
			mainSdk: createFakeMainSdk({ featureId: "notebook" }),
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
				sessionId: "kilo-1",
				title: "Analysis",
			},
			42,
		);

		expect(ensureAvailable).toHaveBeenCalledOnce();
		expect(mocks.createRelay).toHaveBeenCalledOnce();
	});
});
