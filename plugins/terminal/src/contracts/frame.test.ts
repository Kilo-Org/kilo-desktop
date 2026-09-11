import { describe, expect, it } from "vitest";

import { TERMINAL_PROTOCOL_VERSION } from "./session.js";
import { terminalFrameExitedSchema, terminalFrameHostMessageSchema } from "./frame.js";

describe("terminal frame wire contract", () => {
	it("validates versioned messages sent by the frame", () => {
		const exited = {
			type: "terminal:exited",
			protocolVersion: TERMINAL_PROTOCOL_VERSION,
		};
		expect(terminalFrameExitedSchema.safeParse(exited).success).toBe(true);
		expect(terminalFrameHostMessageSchema.safeParse(exited).success).toBe(true);
		expect(
			terminalFrameHostMessageSchema.safeParse({
				...exited,
				protocolVersion: TERMINAL_PROTOCOL_VERSION + 1,
			}).success,
		).toBe(false);
	});
});
