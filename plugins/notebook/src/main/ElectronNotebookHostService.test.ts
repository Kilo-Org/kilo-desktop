import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
	ElectronNotebookHostHandler,
	ElectronNotebookHostServer,
} from "@runtimed/node/electron";
import type { RelayInfo, RelaySession } from "@runtimed/node/relay";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

const mocks = vi.hoisted(() => ({
	createRelay: vi.fn(),
	queryDaemonInfo: vi.fn(),
	serve: vi.fn(),
}));

vi.mock("@runtimed/node/relay", () => ({
	createRelay: mocks.createRelay,
	queryDaemonInfo: mocks.queryDaemonInfo,
}));
vi.mock("@runtimed/node/electron", () => ({
	serveElectronNotebookHost: mocks.serve,
}));

import { ElectronNotebookHostService } from "./ElectronNotebookHostService.js";

function relay(notebookId: string): RelaySession {
	const info: RelayInfo = {
		notebookId,
		commentsNotebookRef: null,
		protocol: "runtimed",
		protocolVersion: 7,
		daemonVersion: "2.6.3",
		socketPath: "/tmp/nightly.sock",
		blobPort: 48637,
		isDevMode: false,
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
			ephemeral: true,
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
		expect(first.close).toHaveBeenCalledOnce();
		expect(server.emit).toHaveBeenCalledWith("transport.status", "reconnecting");
		expect(server.emit).toHaveBeenCalledWith("transport.status", "online");
	});

	it("reports an actionable prerequisite instead of starting a daemon", async () => {
		mocks.queryDaemonInfo.mockResolvedValue(null);
		const service = new ElectronNotebookHostService({
			mainSdk: createFakeMainSdk({ featureId: "notebook" }),
			socketPath: "/tmp/runtimed-nightly.sock",
		});

		await expect(service.status()).resolves.toEqual({
			availability: {
				status: "unavailable",
				reason: "Install and start the nteract nightly runtime daemon.",
			},
			daemon: null,
		});
		expect(mocks.createRelay).not.toHaveBeenCalled();
	});
});
