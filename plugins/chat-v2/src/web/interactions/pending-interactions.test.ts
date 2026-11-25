import { describe, expect, it } from "vitest";
import {
	createOpenCodeThreadState,
	type OpenCodePermissionRequest,
	type OpenCodeQuestionRequest,
	type OpenCodeThreadState,
} from "@kilo-desktop/react-opencode-v2";

import { collectPendingInteractions, subagentOriginOf } from "./pending-interactions";

const permission = (id: string, sessionID: string, askedAt: number): OpenCodePermissionRequest => ({
	id,
	sessionID,
	action: "shell",
	resources: [],
	askedAt,
});

const question = (id: string, sessionID: string, askedAt: number): OpenCodeQuestionRequest => ({
	id,
	sessionID,
	askedAt,
	title: "Questions",
	fields: [{ key: "q0", type: "string" }],
});

const session = (
	sessionId: string,
	{
		permissions = [],
		questions = [],
		children = {},
		taskCalls = {},
	}: {
		permissions?: OpenCodePermissionRequest[];
		questions?: OpenCodeQuestionRequest[];
		children?: Record<string, OpenCodeThreadState>;
		taskCalls?: Record<string, string>;
	} = {},
): OpenCodeThreadState => {
	const base = createOpenCodeThreadState(sessionId);
	return {
		...base,
		messageOrder: ["message"],
		messagesById: {
			message: {
				id: "message",
				type: "assistant",
				agent: "code",
				model: { providerID: "kilo", id: "m" },
				time: { created: 1 },
				content: Object.entries(taskCalls).map(([childSessionId, description]) => ({
					type: "tool" as const,
					id: `call-${childSessionId}`,
					name: "subagent",
					time: { created: 1 },
					state: {
						status: "running" as const,
						input: { agent: "explore", description },
						metadata: { sessionID: childSessionId },
					},
				})),
			},
		},
		childSessionsById: children,
		interactions: {
			...base.interactions,
			permissions: {
				...base.interactions.permissions,
				pending: Object.fromEntries(permissions.map((request) => [request.id, request])),
			},
			questions: {
				...base.interactions.questions,
				pending: Object.fromEntries(questions.map((request) => [request.id, request])),
			},
		},
	};
};

describe("collectPendingInteractions", () => {
	const tree = () =>
		session("root", {
			permissions: [permission("root-permission", "root", 3)],
			taskCalls: { child: "Explore the repo" },
			children: {
				child: session("child", {
					permissions: [permission("child-permission", "child", 2)],
					taskCalls: { grandchild: "List scoped dirs" },
					children: {
						grandchild: session("grandchild", {
							questions: [question("grandchild-question", "grandchild", 1)],
						}),
					},
				}),
			},
		});

	it("collects the whole family oldest-first with subagent titles", () => {
		const interactions = collectPendingInteractions({ state: tree() });

		expect(interactions.rootSessionId).toBe("root");
		expect(interactions.permissions.map((request) => request.id)).toEqual([
			"child-permission",
			"root-permission",
		]);
		expect(interactions.questions.map((request) => request.id)).toEqual(["grandchild-question"]);
		expect(subagentOriginOf(interactions, "root")).toBeUndefined();
		expect(subagentOriginOf(interactions, "child")).toEqual({ title: "Explore the repo" });
		expect(subagentOriginOf(interactions, "grandchild")).toEqual({ title: "List scoped dirs" });
	});

	it("uses the runtime's own root prompts instead of the root state's records", () => {
		const own = { permissions: [permission("live-root", "root", 4)], questions: [] };
		const interactions = collectPendingInteractions({ state: tree(), own });

		expect(interactions.permissions.map((request) => request.id)).toEqual([
			"child-permission",
			"live-root",
		]);
	});

	it("narrows to one subagent's subtree", () => {
		const interactions = collectPendingInteractions({
			state: tree(),
			scopeSessionId: "child",
			own: { permissions: [permission("live-root", "root", 4)], questions: [] },
		});

		expect(interactions.permissions.map((request) => request.id)).toEqual(["child-permission"]);
		expect(interactions.questions.map((request) => request.id)).toEqual(["grandchild-question"]);
		expect(subagentOriginOf(interactions, "child")).toEqual({ title: "Explore the repo" });
	});

	it("returns nothing for an unknown scope or missing state", () => {
		expect(
			collectPendingInteractions({ state: tree(), scopeSessionId: "missing" }).permissions,
		).toEqual([]);
		expect(collectPendingInteractions({ state: undefined }).permissions).toEqual([]);
	});
});
