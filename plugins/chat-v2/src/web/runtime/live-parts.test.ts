import {
	STREAM_RECONNECTED_EVENT_TYPE,
	type OpenCodeServerEvent,
} from "@kilo-desktop/react-opencode-v2";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ENDED_PART_TTL_MS, LiveParts } from "./live-parts";

const CHAT = "ses_1";

const event = (
	type: string,
	properties: Record<string, unknown>,
	sessionId: string | undefined = CHAT,
): OpenCodeServerEvent => ({ type, properties, sessionId, raw: null });

const textPart = (text: string, extra: Record<string, unknown> = {}) => ({
	id: "prt_1",
	messageID: "msg_1",
	sessionID: CHAT,
	type: "text",
	text,
	...extra,
});

const started = (text = "") => event("message.part.updated", { part: textPart(text) });
const delta = (text: string) =>
	event("message.part.delta", { messageID: "msg_1", partID: "prt_1", field: "text", delta: text });
const ended = (text: string) =>
	event("message.part.updated", { part: textPart(text, { time: { start: 1, end: 2 } }) });

/** A history holding `part`. */
const history = (part: Record<string, unknown>) => [{ info: { id: "msg_1" }, parts: [part] }];

/** The first part of `chatId`'s history as `live` patches it. */
async function readPart(live: LiveParts, stored: Record<string, unknown>, chatId = CHAT) {
	return live.patchMessages(chatId, history(stored))[0]!.parts[0]!;
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
	it("fills a streaming part's stored text with what streamed", async () => {
		const live = streaming("Hello ", "world");

		expect((await readPart(live, textPart(""))).text).toBe("Hello world");
	});

	it("leaves a stored part that has ended", async () => {
		const live = streaming("Hello");
		const stored = textPart("Hello world", { time: { start: 1, end: 2 } });

		expect(await readPart(live, stored)).toEqual(stored);
	});

	it("forgets a part once a read shows it ended", async () => {
		const live = streaming("Hello");
		live.apply(event(STREAM_RECONNECTED_EVENT_TYPE, {}, undefined));
		await readPart(live, textPart("Hello world", { time: { start: 1, end: 2 } }));

		expect((await readPart(live, textPart(""))).text).toBe("");
	});

	it("keeps an ended part for other reads after one shows it ended", async () => {
		const live = streaming("Hello");
		live.apply(ended("Hello world"));
		await readPart(live, textPart("Hello world", { time: { start: 1, end: 2 } }));

		expect((await readPart(live, textPart(""))).text).toBe("Hello world");
	});

	it("leaves a stored text the live text doesn't extend", async () => {
		const live = streaming("Hello");

		expect((await readPart(live, textPart("Goodbye"))).text).toBe("Goodbye");
	});

	it("only patches its own chat's parts", async () => {
		const live = streaming("Hello");

		expect((await readPart(live, textPart(""), "ses_other")).text).toBe("");
	});

	it("puts the ended part over a read answered before it ended", async () => {
		const live = streaming("Hello");
		live.apply(ended("Hello world"));

		expect(await readPart(live, textPart("Hel"))).toEqual(
			textPart("Hello world", { time: { start: 1, end: 2 } }),
		);
	});

	it("forgets an ended part once its time runs out", async () => {
		vi.useFakeTimers();
		const live = streaming("Hello");
		live.apply(ended("Hello world"));
		vi.advanceTimersByTime(ENDED_PART_TTL_MS);

		expect((await readPart(live, textPart(""))).text).toBe("");
	});

	it("keeps what streamed across a reconnect", async () => {
		const live = streaming("Hello");
		live.apply(event(STREAM_RECONNECTED_EVENT_TYPE, {}, undefined));

		expect((await readPart(live, textPart(""))).text).toBe("Hello");
	});

	it.each([
		["the part is removed", event("message.part.removed", { messageID: "msg_1", partID: "prt_1" })],
		["its message is removed", event("message.removed", { messageID: "msg_1" })],
		["its chat goes idle", event("session.idle", { sessionID: CHAT })],
		["its chat is deleted", event("session.deleted", { info: { id: CHAT } })],
	])("forgets a streaming part when %s", async (_, drop) => {
		const live = streaming("Hello");
		live.apply(drop);

		expect((await readPart(live, textPart(""))).text).toBe("");
	});

	it("keeps an ended part when its chat goes idle", async () => {
		const live = streaming("Hello");
		live.apply(ended("Hello world"));
		live.apply(event("session.idle", { sessionID: CHAT }));

		expect((await readPart(live, textPart("Hello"))).text).toBe("Hello world");
	});

	it("ignores deltas to parts it didn't see start", async () => {
		const live = new LiveParts();
		live.apply(delta("world"));

		expect((await readPart(live, textPart(""))).text).toBe("");
	});
});
