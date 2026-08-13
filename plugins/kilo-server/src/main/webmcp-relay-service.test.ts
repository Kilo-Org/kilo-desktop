import { describe, expect, it, vi } from "vitest";

import {
	WEBMCP_RELAY_ID,
	WEBMCP_RELAY_LABEL,
	WEBMCP_RELAY_PORT,
} from "./initialize-managed-config.js";
import { WebMcpRelayService, type WebMcpRelayBridge } from "./webmcp-relay-service.js";

function fakeBridge(mode: "server" | "client" = "server"): WebMcpRelayBridge & {
	start: ReturnType<typeof vi.fn<() => Promise<void>>>;
	stop: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
	return {
		mode,
		port: WEBMCP_RELAY_PORT,
		on: vi.fn(),
		off: vi.fn(),
		start: vi.fn(async () => undefined),
		stop: vi.fn(async () => undefined),
	};
}

describe("WebMcpRelayService", () => {
	it("starts an in-process server on the fixed loopback rendezvous", async () => {
		const bridge = fakeBridge();
		const createBridge = vi.fn(() => bridge);
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const service = new WebMcpRelayService({ createBridge, logger });

		await expect(service.start()).resolves.toBe(true);
		expect(createBridge).toHaveBeenCalledWith({
			host: "127.0.0.1",
			port: WEBMCP_RELAY_PORT,
			portExplicitlySet: true,
			relayId: WEBMCP_RELAY_ID,
			label: WEBMCP_RELAY_LABEL,
		});
		expect(logger.info).toHaveBeenCalledWith(
			`WebMCP rendezvous listening on 127.0.0.1:${WEBMCP_RELAY_PORT}.`,
		);

		service.dispose();
		await vi.waitFor(() => expect(bridge.stop).toHaveBeenCalledOnce());
	});

	it("rejects client mode because the existing relay identity is unverified", async () => {
		const bridge = fakeBridge("client");
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const service = new WebMcpRelayService({ createBridge: () => bridge, logger });

		await expect(service.start()).resolves.toBe(false);
		expect(bridge.stop).toHaveBeenCalledOnce();
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("owned by another relay"));
	});

	it("degrades cleanly when the fixed port cannot be bound", async () => {
		const bridge = fakeBridge();
		bridge.start.mockRejectedValue(new Error("Port 9345 is already in use"));
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const service = new WebMcpRelayService({ createBridge: () => bridge, logger });

		await expect(service.start()).resolves.toBe(false);
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
		const service = new WebMcpRelayService({ createBridge: () => bridge });

		const starting = service.start();
		service.dispose();
		releaseStart();

		await expect(starting).resolves.toBe(false);
		expect(bridge.stop).toHaveBeenCalledOnce();
	});
});
