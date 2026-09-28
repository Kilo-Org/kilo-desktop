import { describe, expect, it, vi } from "vitest";

import {
	EMBEDDED_WEB_HOST_CAPABILITY,
	FeatureRouter,
	type HostMessagePort,
} from "@kilo-desktop/feature-sdk/main";

import { TERMINAL_PROTOCOL_VERSION } from "../contracts/session.js";
import { mainRegister, type TerminalManagerLike } from "./index.js";

function fakePort(): HostMessagePort {
	return {
		postMessage: vi.fn(),
		on: vi.fn().mockReturnThis(),
		off: vi.fn().mockReturnThis(),
		start: vi.fn(),
		close: vi.fn(),
	};
}

describe("terminal mainRegister", () => {
	it("registers the validated port, close handler, embedded host, and teardown", async () => {
		const router = new FeatureRouter();
		const mainSdk = router.createMainSdk("terminal", {
			resolveStorageDir: () => "/state/terminal",
			resolvePluginAsset: (subpath) => `/plugins/terminal/${subpath}`,
		});
		const manager = {
			attach: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
			read: vi.fn(async () => ({
				status: "running" as const,
				label: "vite",
				cwd: "/workspace",
				exitCode: null,
				exitSignal: null,
				text: "ready",
				lineCount: 1,
				truncated: false,
			})),
			dispose: vi.fn(async () => undefined),
		} satisfies TerminalManagerLike;
		mainRegister(mainSdk, { manager });

		const port = fakePort();
		const args = {
			protocolVersion: TERMINAL_PROTOCOL_VERSION,
			sessionId: "chat-1",
			terminalId: "terminal-1",
			cwd: "/workspace",
			cols: 120,
			rows: 30,
			initialLabel: "Terminal 1",
		};
		await router.connectPort("terminal", "session", port, args, { senderId: 8 });
		expect(manager.attach).toHaveBeenCalledWith(port, args);
		await expect(
			router.connectPort(
				"terminal",
				"session",
				fakePort(),
				{ ...args, protocolVersion: TERMINAL_PROTOCOL_VERSION + 1 },
				{ senderId: 8 },
			),
		).rejects.toMatchObject({ code: "VALIDATION" });

		await expect(
			router.invoke("terminal", "close", {
				sessionId: "chat-1",
				terminalId: "terminal-1",
				deleteHistory: true,
			}),
		).resolves.toBeUndefined();
		expect(manager.close).toHaveBeenCalledWith(
			{ sessionId: "chat-1", terminalId: "terminal-1" },
			true,
		);
		await expect(
			router.invoke("terminal", "read", {
				sessionId: "chat-1",
				terminalId: "terminal-1",
				lines: 50,
			}),
		).resolves.toMatchObject({ status: "running", text: "ready" });
		expect(manager.read).toHaveBeenCalledWith(
			{ sessionId: "chat-1", terminalId: "terminal-1" },
			50,
		);
		await expect(
			router.invoke("terminal", "read", {
				sessionId: "chat-1",
				terminalId: "terminal-1",
				lines: 5_000,
			}),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(mainSdk.plugins.get("terminal")?.[EMBEDDED_WEB_HOST_CAPABILITY]).toEqual({
			host: "terminal",
			root: "/plugins/terminal/build/terminal",
		});

		await router.destroyFeatureAsync("terminal");
		expect(manager.dispose).toHaveBeenCalledOnce();
	});
});
