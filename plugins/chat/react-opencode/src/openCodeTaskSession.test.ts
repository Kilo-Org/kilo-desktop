import { describe, expect, it } from "vitest";

import { getOpenCodeTaskSessionId, SUBAGENT_TOOL } from "./openCodeTaskSession";
import { runningTool, subagentTool, tool } from "./testUtils";

describe("getOpenCodeTaskSessionId", () => {
	it("reads a subagent call's child session from its state metadata", () => {
		expect(SUBAGENT_TOOL).toBe("subagent");
		expect(getOpenCodeTaskSessionId(subagentTool("call_1", "ses_child"))).toBe("ses_child");
		expect(
			getOpenCodeTaskSessionId(
				tool("call_2", "subagent", {}, "Done", {
					state: {
						status: "completed",
						input: {},
						content: [{ type: "text", text: "Done" }],
						metadata: { sessionID: "ses_done" },
					},
				}),
			),
		).toBe("ses_done");
	});

	it("reads nothing from other tools or invalid metadata", () => {
		expect(
			getOpenCodeTaskSessionId(runningTool("call_1", "read", {}, { sessionID: "ses_child" })),
		).toBeUndefined();
		expect(
			getOpenCodeTaskSessionId(runningTool("call_1", "subagent", {}, { sessionID: 42 })),
		).toBeUndefined();
		expect(
			getOpenCodeTaskSessionId(runningTool("call_1", "subagent", {}, { sessionID: "" })),
		).toBeUndefined();
	});

	it("reads nothing before the call starts (no metadata while its input streams)", () => {
		expect(
			getOpenCodeTaskSessionId({
				name: "subagent",
				state: { status: "streaming", input: '{"agent":' },
			}),
		).toBeUndefined();
	});
});
