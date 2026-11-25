import { describe, expect, it } from "vitest";
import {
	createOpenCodeThreadState,
	type FormInfo,
	type OpenCodeThreadState,
	type PermissionRequest,
} from "@kilo-desktop/react-opencode";

import { assistantMessage, session as sessionInfo, tool } from "../../test/kilo2/fixtures";
import { collectPendingInteractions, subagentOriginOf } from "./pending-interactions";

const permission = (id: string, sessionID: string): PermissionRequest => ({
	id,
	sessionID,
	action: "shell",
	resources: [],
	metadata: {},
});

const question = (id: string, sessionID: string): FormInfo => ({
	id,
	sessionID,
	title: "Questions",
	metadata: { kind: "question" },
	fields: [{ key: "q0", title: "Pick", type: "string" }] as never,
});

const subagentCall = (childSessionId: string, description: string) => {
	const call = tool("subagent", { agent: "explore", description, prompt: "Go" }, "done");
	return { ...call, state: { ...call.state, metadata: { sessionID: childSessionId } } };
};

const session = (
	sessionId: string,
	{
		permissions = [],
		questions = [],
		children = {},
		subagentCalls = {},
	}: {
		permissions?: PermissionRequest[];
		questions?: FormInfo[];
		children?: Record<string, OpenCodeThreadState>;
		subagentCalls?: Record<string, string>;
	} = {},
): OpenCodeThreadState => {
	const base = createOpenCodeThreadState(sessionId);
	const calls = Object.entries(subagentCalls).map(([childSessionId, description]) =>
		subagentCall(childSessionId, description),
	);
	return {
		...base,
		messages: calls.length > 0 ? [assistantMessage(calls)] : [],
		childSessionsById: children,
		interactions: {
			...base.interactions,
			permissions: {
				...base.interactions.permissions,
				pending: Object.fromEntries(permissions.map((request) => [request.id, request])),
			},
			questions: {
				...base.interactions.questions,
				pending: Object.fromEntries(questions.map((form) => [form.id, form])),
			},
		},
	};
};

describe("collectPendingInteractions", () => {
	const tree = () =>
		session("root", {
			permissions: [permission("per_3", "root")],
			subagentCalls: { child: "Explore the repo" },
			children: {
				child: session("child", {
					permissions: [permission("per_2", "child")],
					subagentCalls: { grandchild: "List scoped dirs" },
					children: {
						grandchild: session("grandchild", {
							questions: [question("frm_1", "grandchild")],
						}),
					},
				}),
			},
		});

	it("collects the whole family oldest-first (by id) with subagent titles", () => {
		const interactions = collectPendingInteractions({ state: tree() });

		expect(interactions.rootSessionId).toBe("root");
		expect(interactions.permissions.map((request) => request.id)).toEqual(["per_2", "per_3"]);
		expect(interactions.questions.map((form) => form.id)).toEqual(["frm_1"]);
		expect(subagentOriginOf(interactions, "root")).toBeUndefined();
		expect(subagentOriginOf(interactions, "child")).toEqual({ title: "Explore the repo" });
		expect(subagentOriginOf(interactions, "grandchild")).toEqual({ title: "List scoped dirs" });
	});

	it("falls back to the child session's title when no subagent call names it", () => {
		const titled = {
			...session("child", { permissions: [permission("per_1", "child")] }),
			session: sessionInfo("child", { title: "Child session" }),
		};
		const interactions = collectPendingInteractions({
			state: session("root", { children: { child: titled } }),
		});
		expect(subagentOriginOf(interactions, "child")).toEqual({ title: "Child session" });
	});

	it("uses the runtime's own root prompts instead of the root state's records", () => {
		const own = { permissions: [permission("per_4", "root")], questions: [] };
		const interactions = collectPendingInteractions({ state: tree(), own });

		expect(interactions.permissions.map((request) => request.id)).toEqual(["per_2", "per_4"]);
	});

	it("narrows to one subagent's subtree", () => {
		const interactions = collectPendingInteractions({
			state: tree(),
			scopeSessionId: "child",
			own: { permissions: [permission("per_4", "root")], questions: [] },
		});

		expect(interactions.permissions.map((request) => request.id)).toEqual(["per_2"]);
		expect(interactions.questions.map((form) => form.id)).toEqual(["frm_1"]);
		expect(subagentOriginOf(interactions, "child")).toEqual({ title: "Explore the repo" });
	});

	it("returns nothing for an unknown scope or missing state", () => {
		expect(
			collectPendingInteractions({ state: tree(), scopeSessionId: "missing" }).permissions,
		).toEqual([]);
		expect(collectPendingInteractions({ state: undefined }).permissions).toEqual([]);
	});
});
