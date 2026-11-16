import { describe, expect, it } from "vitest";

import {
	TERMINAL_PROTOCOL_VERSION,
	terminalClientMessageSchema,
	terminalConnectionArgsSchema,
	terminalServerMessageSchema,
} from "./session";

describe("terminal session wire contract", () => {
	it("validates versioned connection identities and dimensions", () => {
		expect(
			terminalConnectionArgsSchema.parse({
				protocolVersion: TERMINAL_PROTOCOL_VERSION,
				sessionId: "chat-1",
				terminalId: "terminal-1",
				cwd: "/workspace",
				cols: 120,
				rows: 30,
				initialLabel: "Terminal 1",
			}),
		).toMatchObject({ terminalId: "terminal-1" });
		expect(
			terminalConnectionArgsSchema.safeParse({
				protocolVersion: TERMINAL_PROTOCOL_VERSION,
				sessionId: "chat-1",
				terminalId: "terminal-1",
				cols: 120,
				rows: 30,
				initialLabel: "Terminal 1",
			}).success,
		).toBe(true);
		expect(
			terminalConnectionArgsSchema.safeParse({
				protocolVersion: TERMINAL_PROTOCOL_VERSION + 1,
				sessionId: "chat-1",
				terminalId: "terminal-1",
				cwd: "/workspace",
				cols: 1,
				rows: 30,
				initialLabel: "Terminal 1",
			}).success,
		).toBe(false);
	});

	it("rejects unknown port message variants", () => {
		expect(
			terminalClientMessageSchema.safeParse({
				type: "input",
				requestId: "input-1",
				data: "pwd\r",
			}).success,
		).toBe(true);
		expect(terminalClientMessageSchema.safeParse({ type: "destroy" }).success).toBe(false);
		expect(
			terminalServerMessageSchema.safeParse({
				type: "snapshot",
				status: "running",
				cwd: "/workspace",
				history: "ready\r\n",
				acceptedInputCount: 4,
				exitCode: null,
				exitSignal: null,
				label: "Terminal 1",
			}).success,
		).toBe(true);
		expect(
			terminalServerMessageSchema.safeParse({ type: "input-accepted", count: 5 }).success,
		).toBe(true);
		expect(terminalServerMessageSchema.safeParse({ type: "label", label: "vite" }).success).toBe(
			true,
		);
	});
});
