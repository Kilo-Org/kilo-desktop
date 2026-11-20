import { describe, expect, it } from "vitest";

import {
	createOpenCodeThreadState,
	projectOpenCodeThreadMessages,
	type OpenCodeServerMessage,
	type OpenCodeThreadState,
} from "@kilo-desktop/react-opencode";

/**
 * Parity with kilo-vscode (`snapshotProgress` / `isRenderable`): the Kilo
 * server's synthetic "Initializing snapshot…" text part is a transient status
 * indicator, not chat content. Feeding it to the smoothed markdown renderer
 * restarts the typewriter animation on every 120ms spinner frame, so the
 * projection must keep it out of the message's text parts.
 *
 * The server marks the part with `kilocode.lifecycle: "transient"`
 * (`KiloPartLifecycle` in kilocode). The projection requires that marker —
 * not the text alone — so durable synthetic parts with matching text (see
 * kilocode's session-fork-remap tests) stay renderable as content.
 */

const PROGRESS_TEXT = "⠋ Initializing snapshot…";

const snapshotProgressPart = {
	id: "part-progress",
	messageID: "msg-assistant",
	sessionID: "session-1",
	type: "text",
	text: PROGRESS_TEXT,
	synthetic: true,
	metadata: { "kilocode.lifecycle": "transient" },
};

function assistantMessage(
	parts: readonly unknown[],
	info: Record<string, unknown> = {},
): OpenCodeServerMessage {
	return {
		id: "msg-assistant",
		info: {
			role: "assistant",
			id: "msg-assistant",
			sessionID: "session-1",
			time: { created: 1_000 },
			modelID: "test-model",
			providerID: "kilo",
			...info,
		},
		parts,
		shadowParts: undefined,
	} as unknown as OpenCodeServerMessage;
}

function userMessage(parts: readonly unknown[]): OpenCodeServerMessage {
	return {
		id: "msg-user",
		info: {
			role: "user",
			id: "msg-user",
			sessionID: "session-1",
			time: { created: 1_000 },
		},
		parts,
		shadowParts: undefined,
	} as unknown as OpenCodeServerMessage;
}

function project(message: OpenCodeServerMessage) {
	const state: OpenCodeThreadState = {
		...createOpenCodeThreadState("session-1"),
		messageOrder: [message.id],
		messagesById: { [message.id]: message },
	};
	const [projected] = projectOpenCodeThreadMessages(state);
	if (!projected) throw new Error("expected the assistant message to project");
	return projected;
}

function projectWithRunState(
	message: OpenCodeServerMessage,
	runState: OpenCodeThreadState["runState"],
) {
	const state: OpenCodeThreadState = {
		...createOpenCodeThreadState("session-1"),
		runState,
		messageOrder: [message.id],
		messagesById: { [message.id]: message },
	};
	const [projected] = projectOpenCodeThreadMessages(state);
	if (!projected) throw new Error("expected the assistant message to project");
	return projected;
}

function projectMessages(messages: OpenCodeServerMessage[]) {
	const state: OpenCodeThreadState = {
		...createOpenCodeThreadState("session-1"),
		messageOrder: messages.map((message) => message.id),
		messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
	};
	return projectOpenCodeThreadMessages(state);
}

describe("snapshot progress projection", () => {
	it("marks an unfinished restored assistant message as cancelled when the thread is idle", () => {
		const projected = project(assistantMessage([]));

		expect(projected.status).toEqual({ type: "incomplete", reason: "cancelled" });
	});

	it("keeps the active unfinished assistant message running during a live stream", () => {
		const projected = projectWithRunState(assistantMessage([]), { type: "streaming" });

		expect(projected.status).toEqual({ type: "running" });
	});

	it("projects the synthetic snapshot progress part as a data part, never as text", () => {
		const projected = project(assistantMessage([snapshotProgressPart]));

		expect(projected.content).toEqual([
			{
				type: "data",
				name: "opencode-snapshot-progress",
				data: { text: PROGRESS_TEXT },
			},
		]);
	});

	it("drops the synthetic part entirely when the owning message already finished", () => {
		const projected = project(assistantMessage([snapshotProgressPart], { finish: "stop" }));

		expect(projected.content).toEqual([]);
	});

	it("keeps regular text parts untouched", () => {
		const projected = project(assistantMessage([{ id: "part-text", type: "text", text: "hello" }]));

		expect(projected.content).toEqual([{ type: "text", text: "hello" }]);
	});

	it("keeps non-snapshot synthetic text as content while the message is running", () => {
		const projected = project(
			assistantMessage([{ id: "part-note", type: "text", text: "note", synthetic: true }]),
		);

		expect(projected.content).toEqual([{ type: "text", text: "note" }]);
	});

	it("keeps durable synthetic snapshot-text parts as content when they lack the lifecycle marker", () => {
		const durable = { ...snapshotProgressPart, metadata: undefined };
		const projected = project(assistantMessage([durable]));

		expect(projected.content).toEqual([{ type: "text", text: PROGRESS_TEXT }]);
	});

	it("keeps transient synthetic parts with non-snapshot text as content", () => {
		const other = { ...snapshotProgressPart, text: "reindexing workspace" };
		const projected = project(assistantMessage([other]));

		expect(projected.content).toEqual([{ type: "text", text: "reindexing workspace" }]);
	});

	it("drops the synthetic part when the message errored", () => {
		const projected = project(
			assistantMessage([snapshotProgressPart], { error: { name: "MessageAbortedError" } }),
		);

		expect(projected.content).toEqual([]);
	});
});

describe("synthetic user text projection", () => {
	it("hides synthetic context while preserving user-authored text", () => {
		const projected = project(
			userMessage([
				{ id: "part-user", type: "text", text: "Implement the change." },
				{
					id: "part-reminder",
					type: "text",
					text: "<system-reminder>Follow the Code agent.</system-reminder>",
					synthetic: true,
				},
			]),
		);

		expect(projected.content).toEqual([{ type: "text", text: "Implement the change." }]);
	});

	it("folds background task continuations into the preceding visible assistant turn", () => {
		const initialUser = {
			...userMessage([
				{ id: "part-user", type: "text", text: "Investigate both implementations." },
			]),
			id: "msg-user",
		};
		const initialAssistant = assistantMessage(
			[{ id: "part-task", type: "tool", tool: "task", callID: "call-task", state: {} }],
			{ id: "msg-assistant", parentID: "msg-user", finish: "tool-calls" },
		);
		const backgroundUser = {
			...userMessage([
				{
					id: "part-background",
					type: "text",
					text: "Background task completed: compare implementations",
					synthetic: true,
					metadata: { background: true },
				},
			]),
			id: "msg-background",
			info: {
				role: "user",
				id: "msg-background",
				sessionID: "session-1",
				time: { created: 2_000 },
			},
		} as unknown as OpenCodeServerMessage;
		const finalAssistant = assistantMessage(
			[{ id: "part-final", type: "text", text: "Here is the comparison." }],
			{
				id: "msg-final",
				parentID: "msg-background",
				finish: "stop",
				time: { created: 2_100, completed: 3_000 },
			},
		);
		finalAssistant.id = "msg-final";

		const projected = projectMessages([
			initialUser,
			initialAssistant,
			backgroundUser,
			finalAssistant,
		]);

		expect(projected).toHaveLength(2);
		expect(projected.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(projected[1]?.content).toEqual([
			expect.objectContaining({ type: "tool-call", toolName: "task" }),
			{ type: "text", text: "Here is the comparison." },
		]);
	});

	it("leaves out a user message that is only hidden context, like a fork's handoff note", () => {
		const typed = { ...userMessage([{ id: "p1", type: "text", text: "Fix the login" }]) };
		const handoff = {
			...userMessage([
				{
					id: "p2",
					type: "text",
					text: "<system-reminder>This session was forked…</system-reminder>",
					synthetic: true,
				},
			]),
			id: "msg-handoff",
		} as OpenCodeServerMessage;

		const projected = projectMessages([typed, handoff]);

		expect(projected.map((message) => message.id)).toEqual(["msg-user"]);
	});

	it("keeps a user message that is still waiting for its parts", () => {
		expect(projectMessages([userMessage([])]).map((message) => message.id)).toEqual(["msg-user"]);
	});
});
