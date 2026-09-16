import { describe, expect, it } from "vitest";

import {
	createOpenCodeThreadState,
	projectOpenCodeThreadMessages,
	type OpenCodeServerMessage,
	type OpenCodeThreadState,
} from "@assistant-ui/react-opencode";

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

describe("snapshot progress projection", () => {
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
});
