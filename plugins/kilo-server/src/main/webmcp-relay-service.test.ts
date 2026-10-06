import { RelayBridgeServer } from "@mcp-b/webmcp-local-relay";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WEBMCP_RELAY_ID, WEBMCP_RELAY_LABEL, WEBMCP_RELAY_PORT } from "./webmcp-relay-config.js";
import type { WebMcpHttpEndpointConnection } from "./webmcp-http-endpoint.js";
import { WebMcpRelayService, type WebMcpEndpointHandle } from "./webmcp-relay-service.js";

const CONNECTION: WebMcpHttpEndpointConnection = {
	url: "http://127.0.0.1:50123/mcp",
	token: "endpoint-token",
};

function fakeBridge(mode: "server" | "client" = "server") {
	const bridge = {
		mode,
		port: WEBMCP_RELAY_PORT,
		on: vi.fn(),
		off: vi.fn(),
		start: vi.fn(async (): Promise<void> => undefined),
		stop: vi.fn(async (): Promise<void> => undefined),
	};
	// The service only uses the members above; the endpoint is faked too.
	return Object.assign(bridge, { asBridge: () => bridge as unknown as RelayBridgeServer });
}

function fakeEndpoint(): WebMcpEndpointHandle & {
	start: ReturnType<typeof vi.fn<() => Promise<WebMcpHttpEndpointConnection>>>;
	stop: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
	return { start: vi.fn(async () => CONNECTION), stop: vi.fn(async () => undefined) };
}

describe("WebMcpRelayService", () => {
	it("starts an in-process server on the fixed loopback rendezvous", async () => {
		const bridge = fakeBridge();
		const endpoint = fakeEndpoint();
		const createBridge = vi.fn(() => bridge.asBridge());
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const service = new WebMcpRelayService({
			createBridge,
			createEndpoint: () => endpoint,
			logger,
		});

		await expect(service.start()).resolves.toEqual(CONNECTION);
		expect(createBridge).toHaveBeenCalledWith({
			host: "127.0.0.1",
			port: WEBMCP_RELAY_PORT,
			portExplicitlySet: true,
			relayId: WEBMCP_RELAY_ID,
			label: WEBMCP_RELAY_LABEL,
			allowedOrigins: ["kilo-desktop://app", "kilo-desktop-dev://app"],
		});
		expect(logger.info).toHaveBeenCalledWith(
			`WebMCP rendezvous listening on 127.0.0.1:${WEBMCP_RELAY_PORT}.`,
		);

		service.dispose();
		await vi.waitFor(() => expect(bridge.stop).toHaveBeenCalledOnce());
		expect(endpoint.stop).toHaveBeenCalledOnce();
	});

	it("serves the MCP endpoint only after owning the rendezvous", async () => {
		const bridge = fakeBridge();
		const createEndpoint = vi.fn((_bridge: RelayBridgeServer) => fakeEndpoint());
		const service = new WebMcpRelayService({
			createBridge: () => bridge.asBridge(),
			createEndpoint,
		});

		await service.start();

		expect(bridge.start.mock.invocationCallOrder[0]).toBeLessThan(
			createEndpoint.mock.invocationCallOrder[0]!,
		);
		expect(createEndpoint).toHaveBeenCalledWith(bridge);
		service.dispose();
	});

	it("keeps the rendezvous for external clients when the MCP endpoint cannot start", async () => {
		const bridge = fakeBridge();
		const endpoint = fakeEndpoint();
		endpoint.start.mockRejectedValue(new Error("listen EACCES"));
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const service = new WebMcpRelayService({
			createBridge: () => bridge.asBridge(),
			createEndpoint: () => endpoint,
			logger,
		});

		await expect(service.start()).resolves.toBeUndefined();
		expect(bridge.stop).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("listen EACCES"));
		service.dispose();
	});

	it("rejects client mode because the existing relay identity is unverified", async () => {
		const bridge = fakeBridge("client");
		const createEndpoint = vi.fn(() => fakeEndpoint());
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const service = new WebMcpRelayService({
			createBridge: () => bridge.asBridge(),
			createEndpoint,
			logger,
		});

		await expect(service.start()).resolves.toBeUndefined();
		expect(createEndpoint).not.toHaveBeenCalled();
		expect(bridge.stop).toHaveBeenCalledOnce();
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("owned by another relay"));
	});

	it("degrades cleanly when the fixed port cannot be bound", async () => {
		const bridge = fakeBridge();
		bridge.start.mockRejectedValue(new Error("Port 9345 is already in use"));
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const service = new WebMcpRelayService({
			createBridge: () => bridge.asBridge(),
			createEndpoint: () => fakeEndpoint(),
			logger,
		});

		await expect(service.start()).resolves.toBeUndefined();
		expect(bridge.stop).toHaveBeenCalledOnce();
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("already in use"));
	});

	it("stops a bridge that finishes starting after disposal", async () => {
		let releaseStart!: () => void;
		const startGate = new Promise<void>((resolve) => {
			releaseStart = resolve;
		});
		const bridge = fakeBridge();
		bridge.start.mockReturnValue(startGate);
		const service = new WebMcpRelayService({
			createBridge: () => bridge.asBridge(),
			createEndpoint: () => fakeEndpoint(),
		});

		const starting = service.start();
		service.dispose();
		releaseStart();

		await expect(starting).resolves.toBeUndefined();
		expect(bridge.stop).toHaveBeenCalledOnce();
	});
});

describe("WebMcpRelayService tool-source origins", () => {
	let service: WebMcpRelayService | undefined;

	afterEach(() => {
		service?.dispose();
		service = undefined;
	});

	async function startRealRelay(): Promise<number> {
		let bridge: RelayBridgeServer | undefined;
		service = new WebMcpRelayService({
			port: 0,
			createBridge: (options) => (bridge = new RelayBridgeServer(options)),
		});
		await expect(service.start()).resolves.toMatchObject({ url: expect.stringContaining("/mcp") });
		return bridge!.port;
	}

	function registerToolSource(port: number, origin: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin } } as never);
			socket.addEventListener("open", () =>
				socket.send(JSON.stringify({ type: "hello", tabId: "tab-1", origin })),
			);
			socket.addEventListener("message", (event) => {
				const { type } = JSON.parse(String(event.data)) as { type: string };
				if (type !== "hello/accepted" && type !== "hello/rejected") return;
				socket.close();
				resolve(type);
			});
			socket.addEventListener("error", () => reject(new Error("relay socket error")));
		});
	}

	it("rejects tool sources from web pages", async () => {
		const port = await startRealRelay();

		await expect(registerToolSource(port, "https://evil.example")).resolves.toBe("hello/rejected");
	});

	it.each(["kilo-desktop://app", "kilo-desktop-dev://app"])(
		"accepts tool sources from the app renderer at %s",
		async (origin) => {
			const port = await startRealRelay();

			await expect(registerToolSource(port, origin)).resolves.toBe("hello/accepted");
		},
	);
});
