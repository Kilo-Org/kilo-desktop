import { describe, expect, it } from "vitest";
import { getOpenCodeTaskSessionId } from "./openCodeTaskSession";

const subagentCall = (overrides: Record<string, unknown>) => ({
	type: "tool",
	id: "call_1",
	name: "subagent",
	time: { created: 1 },
	state: { status: "running", input: { agent: "explore" }, metadata: {} },
	...overrides,
});

describe("getOpenCodeTaskSessionId", () => {
	it("reads a subagent call's child session from its metadata", () => {
		expect(
			getOpenCodeTaskSessionId(
				subagentCall({
					state: { status: "running", input: {}, metadata: { sessionID: "ses_child" } },
				}),
			),
		).toBe("ses_child");
	});

	it("ignores other tools, calls without a session yet, and invalid metadata", () => {
		expect(
			getOpenCodeTaskSessionId(
				subagentCall({
					name: "read",
					state: { status: "running", input: {}, metadata: { sessionID: "x" } },
				}),
			),
		).toBeUndefined();
		expect(getOpenCodeTaskSessionId(subagentCall({}))).toBeUndefined();
		expect(
			getOpenCodeTaskSessionId(
				subagentCall({ state: { status: "running", input: {}, metadata: { sessionID: 42 } } }),
			),
		).toBeUndefined();
		expect(getOpenCodeTaskSessionId({ type: "text", text: "hi" })).toBeUndefined();
	});
});
