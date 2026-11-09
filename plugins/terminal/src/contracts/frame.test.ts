import { describe, expect, it } from "vitest";

import { TERMINAL_PROTOCOL_VERSION } from "./session.js";
import { terminalFrameHostMessageSchema } from "./frame.js";

describe("terminal frame wire contract", () => {
	it("validates versioned messages sent by the frame", () => {
		const ready = {
			type: "terminal:ready",
			protocolVersion: TERMINAL_PROTOCOL_VERSION,
		};
		expect(terminalFrameHostMessageSchema.safeParse(ready).success).toBe(true);
		expect(
			terminalFrameHostMessageSchema.safeParse({
				...ready,
				protocolVersion: TERMINAL_PROTOCOL_VERSION + 1,
			}).success,
		).toBe(false);
	});
});
