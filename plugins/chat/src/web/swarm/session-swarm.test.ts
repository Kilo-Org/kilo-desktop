import { describe, expect, it } from "vitest";

import { chatSummary } from "../../test/fake-core";
import { sessionSwarmState, swarmLabel } from "./session-swarm";

const busy = { status: "busy" as const, pendingPermissionIds: [], pendingQuestionIds: [] };

const chats = Object.fromEntries(
	[
		chatSummary("ses_root"),
		chatSummary("ses_w1", { parentId: "ses_root", activity: busy }),
		chatSummary("ses_w2", { parentId: "ses_root" }),
		chatSummary("ses_nested", {
			parentId: "ses_w2",
			activity: { status: "idle", pendingPermissionIds: ["per_1"], pendingQuestionIds: [] },
		}),
		chatSummary("ses_other"),
		chatSummary("ses_other_w", { parentId: "ses_other", activity: busy }),
	].map((chat) => [chat.id, chat]),
);

describe("sessionSwarmState", () => {
	it("counts every subagent below the work session's chats, nested ones too", () => {
		expect(sessionSwarmState(["ses_root"], chats)).toEqual({
			subagents: 3,
			working: 1,
			needsYou: 1,
		});
	});

	it("is empty for a work session whose chats never delegated", () => {
		expect(sessionSwarmState([], chats).subagents).toBe(0);
		expect(sessionSwarmState(["ses_w1"], chats).subagents).toBe(0);
	});
});

describe("swarmLabel", () => {
	it("puts the person first, then the work", () => {
		expect(swarmLabel({ subagents: 3, working: 2, needsYou: 1 })).toBe("Swarm: 1 needs you");
		expect(swarmLabel({ subagents: 3, working: 2, needsYou: 0 })).toBe("Swarm: 2 working");
		expect(swarmLabel({ subagents: 3, working: 0, needsYou: 0 })).toBe("Swarm: 3 finished");
	});
});
