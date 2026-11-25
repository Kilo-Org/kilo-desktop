import {
	STREAM_RECONNECTED_EVENT_TYPE,
	type OpenCodeServerEvent,
	type SessionMessageInfo,
} from "@kilo-desktop/react-opencode-v2";
import { afterEach, describe, expect, it, vi } from "vitest";

import { streamEvent } from "../../test/stream-events";
import { ENDED_PART_TTL_MS, LiveParts } from "./live-parts";

const CHAT = "ses_1";

const event = (
	type: string,
	data: Record<string, unknown>,
	sessionId: string | undefined = CHAT,
): OpenCodeServerEvent => streamEvent(type, data, sessionId);

const ids = { assistantMessageID: "msg_1", ordinal: 0 };
const started = () => event("session.text.started", ids);
const delta = (text: string) => event("session.text.delta", { ...ids, delta: text });
const ended = (text: string) => event("session.text.ended", { ...ids, text });

/** A history holding a step with one text item, finished or not. */
const history = (text: string, completed?: number): SessionMessageInfo[] => [
	{
		id: "msg_1",
		type: "assistant",
		agent: "code",
		model: { providerID: "kilo", id: "m" },
		content: [{ type: "text", text }],
		time: completed === undefined ? { created: 1 } : { created: 1, completed },
	},
];

/** The step's text in `chatId`'s history as `live` patches it. */
function readText(live: LiveParts, stored: string, chatId = CHAT, completed?: number) {
	const [message] = live.patchMessages(chatId, history(stored, completed));
	return message?.type === "assistant" && message.content[0]?.type === "text"
		? message.content[0].text
		: undefined;
}

function streaming(...deltas: string[]) {
	const live = new LiveParts();
	live.apply(started());
	for (const text of deltas) live.apply(delta(text));
	return live;
}

afterEach(() => {
	vi.useRealTimers();
});

describe("LiveParts", () => {
	it("fills an unfinished step's stored text with what streamed", () => {
		expect(readText(streaming("Hello ", "world"), "Hello")).toBe("Hello world");
	});

	it("streams reasoning the same way", () => {
		const live = new LiveParts();
		live.apply(event("session.reasoning.started", ids));
		live.apply(event("session.reasoning.delta", { ...ids, delta: "Thinking" }));
		const [message] = live.patchMessages(CHAT, [
			{ ...history("")[0]!, content: [{ type: "reasoning", text: "" }] } as SessionMessageInfo,
		]);
		expect(message?.type === "assistant" && message.content[0]).toEqual({
			type: "reasoning",
			text: "Thinking",
		});
	});

	it("leaves a finished step, and forgets what streamed into it", () => {
		const live = streaming("Hello");
		expect(readText(live, "Hello world", CHAT, 5)).toBe("Hello world");
		expect(readText(live, "")).toBe("");
	});

	it("leaves a stored text the live text doesn't extend", () => {
		expect(readText(streaming("Hello"), "Goodbye")).toBe("Goodbye");
	});

	it("only patches its own chat's steps", () => {
		expect(readText(streaming("Hello"), "", "ses_other")).toBe("");
	});

	it("puts the ended text over a read answered before it ended, until its time runs out", () => {
		vi.useFakeTimers();
		const live = streaming("Hello");
		live.apply(ended("Hello world"));
		expect(readText(live, "Hel")).toBe("Hello world");

		vi.advanceTimersByTime(ENDED_PART_TTL_MS);
		expect(readText(live, "Hel")).toBe("Hel");
	});

	it("keeps what streamed across a reconnect", () => {
		const live = streaming("Hello");
		live.apply({ type: STREAM_RECONNECTED_EVENT_TYPE });
		expect(readText(live, "")).toBe("Hello");
	});

	it.each([
		["its chat's turn ends", event("session.execution.succeeded", {})],
		["its chat is deleted", event("session.deleted", {})],
	])("forgets a streaming item when %s", (_, drop) => {
		const live = streaming("Hello");
		live.apply(drop);
		expect(readText(live, "")).toBe("");
	});

	it("keeps an ended item when its chat's turn ends", () => {
		const live = streaming("Hello");
		live.apply(ended("Hello world"));
		live.apply(event("session.execution.succeeded", {}));
		expect(readText(live, "Hello")).toBe("Hello world");
	});

	it("ignores deltas to items it didn't see start", () => {
		const live = new LiveParts();
		live.apply(delta("world"));
		expect(readText(live, "")).toBe("");
	});
});
