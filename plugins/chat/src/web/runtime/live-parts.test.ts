import type {
	OpenCodeServerEvent,
	SessionMessageAssistant,
	SessionMessageInfo,
} from "@kilo-desktop/react-opencode";
import type { OpenCodeClient } from "@kilocode/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assistantMessage, reasoning, text, userMessage } from "../../test/kilo2/fixtures";
import { ENDED_PART_TTL_MS, LiveParts, withLiveParts } from "./live-parts";

const CHAT = "ses_1";
const MESSAGE = "msg_1";

const event = (
	type: string,
	data: Record<string, unknown> = {},
	sessionId: string | undefined = CHAT,
): OpenCodeServerEvent => ({
	type,
	data: { sessionID: sessionId, ...data },
	sessionId,
});

const part = (kind: "text" | "reasoning", phase: string, ordinal: number, extra = {}) =>
	event(`session.${kind}.${phase}`, { assistantMessageID: MESSAGE, ordinal, ...extra });

const started = (ordinal = 0, kind: "text" | "reasoning" = "text") =>
	part(kind, "started", ordinal);
const delta = (value: string, ordinal = 0, kind: "text" | "reasoning" = "text") =>
	part(kind, "delta", ordinal, { delta: value });
const ended = (value: string, ordinal = 0) => part("text", "ended", ordinal, { text: value });

function streaming(...deltas: string[]) {
	const live = new LiveParts();
	live.apply(started());
	for (const value of deltas) live.apply(delta(value));
	return live;
}

const stored = (...content: SessionMessageAssistant["content"]) =>
	({ ...assistantMessage(content), id: MESSAGE }) as SessionMessageAssistant;

/** The assistant message's content as `chatId`'s `message.list` reads it through `withLiveParts`. */
async function readContent(
	live: LiveParts,
	message: SessionMessageAssistant,
	chatId = CHAT,
): Promise<SessionMessageAssistant["content"]> {
	const reply = { data: [message] as SessionMessageInfo[], cursor: { next: "older" } };
	const client = { message: { list: async () => reply } } as unknown as OpenCodeClient;
	const read = await withLiveParts(client, live).message.list({ sessionID: chatId });
	expect(read.cursor).toEqual({ next: "older" });
	return (read.data[0] as SessionMessageAssistant).content;
}

afterEach(() => {
	vi.useRealTimers();
});

describe("LiveParts", () => {
	it("fills a streaming part's stored text with what streamed", async () => {
		const live = streaming("Hel", "lo");

		await expect(readContent(live, stored(text("")))).resolves.toEqual([text("Hello")]);
	});

	it("finds each part by its kind and ordinal", async () => {
		const live = new LiveParts();
		live.apply(started(0, "reasoning"));
		live.apply(delta("thinking", 0, "reasoning"));
		live.apply(started(0));
		live.apply(delta("first"));
		live.apply(ended("first"));
		live.apply(started(1));
		live.apply(delta("second", 1));

		const content = await readContent(live, stored(reasoning(""), text("first"), text("")));

		expect(content.map((item) => (item.type === "tool" ? item.id : item.text))).toEqual([
			"thinking",
			"first",
			"second",
		]);
	});

	it("keeps stored text the live text doesn't extend", async () => {
		const live = streaming("abc");

		await expect(readContent(live, stored(text("xyz")))).resolves.toEqual([text("xyz")]);
		await expect(readContent(live, stored(text("abcd")))).resolves.toEqual([text("abcd")]);
	});

	it("leaves other chats, messages and kinds alone", async () => {
		const live = streaming("Hello");
		const other = { ...stored(text("")), id: "msg_2" } as SessionMessageAssistant;

		await expect(readContent(live, stored(text("")), "ses_2")).resolves.toEqual([text("")]);
		await expect(readContent(live, other)).resolves.toEqual([text("")]);
		const thought = reasoning("");
		await expect(readContent(live, stored(thought))).resolves.toEqual([thought]);
	});

	it("patches with an ended part's final text until it expires", async () => {
		vi.useFakeTimers();
		const live = streaming("Hel");
		live.apply(ended("Hello"));
		live.apply(event("session.step.ended", { assistantMessageID: MESSAGE }));

		await expect(readContent(live, stored(text("")))).resolves.toEqual([text("Hello")]);
		vi.advanceTimersByTime(ENDED_PART_TTL_MS);
		await expect(readContent(live, stored(text("")))).resolves.toEqual([text("")]);
	});

	it("forgets a part cut off when its step ends or fails, or its execution ends", async () => {
		const ends = [
			event("session.step.ended", { assistantMessageID: MESSAGE }),
			event("session.step.failed", { assistantMessageID: MESSAGE }),
			event("session.execution.interrupted"),
		];
		const reads = ends.map((end) => {
			const live = streaming("Hel");
			live.apply(end);
			live.apply(delta("lo"));
			return readContent(live, stored(text("")));
		});

		await expect(Promise.all(reads)).resolves.toEqual(ends.map(() => [text("")]));
	});

	it("forgets every part of a deleted chat", async () => {
		const live = streaming("Hel");
		live.apply(ended("Hello"));
		live.apply(event("session.deleted"));

		await expect(readContent(live, stored(text("")))).resolves.toEqual([text("")]);
	});

	it("patches a read when the thread reads it, with what streamed meanwhile", async () => {
		const live = streaming("Hel");
		const reply = { data: [stored(text(""))] as SessionMessageInfo[], cursor: {} };
		const client = { message: { list: async () => reply } } as unknown as OpenCodeClient;
		const read = await withLiveParts(client, live).message.list({ sessionID: CHAT });

		live.apply(delta("lo"));

		expect((read.data[0] as SessionMessageAssistant).content).toEqual([text("Hello")]);
	});

	it("passes other messages and calls through", async () => {
		const live = streaming("Hello");
		const user = userMessage("hi");
		const client = {
			message: { list: async () => ({ data: [user], cursor: {} }) },
			session: { get: async () => "session" },
		} as unknown as OpenCodeClient;
		const wrapped = withLiveParts(client, live);

		await expect(wrapped.message.list({ sessionID: CHAT })).resolves.toMatchObject({
			data: [user],
		});
		await expect(wrapped.session.get({ sessionID: CHAT })).resolves.toBe("session");
	});
});
