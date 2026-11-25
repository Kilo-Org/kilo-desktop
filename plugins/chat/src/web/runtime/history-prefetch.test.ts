import { OPEN_CODE_HISTORY_PAGE_SIZE } from "@kilo-desktop/react-opencode";
import type { OpenCodeClient } from "@kilocode/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HistoryPrefetch, PREFETCH_TTL_MS, withPrefetchedHistory } from "./history-prefetch";

/** The thread's first history read: its newest page. */
const FIRST_PAGE = { sessionID: "ses_1", limit: OPEN_CODE_HISTORY_PAGE_SIZE };

function fakeClient() {
	const get = vi.fn(async (parameters: { sessionID: string }) => ({ id: parameters.sessionID }));
	const messages = vi.fn(async () => ({ data: [{ id: "msg_1" }], cursor: {} }));
	const prompt = vi.fn();
	return {
		client: { session: { get, prompt }, message: { list: messages } } as never as OpenCodeClient,
		get,
		messages,
		prompt,
	};
}

function setup() {
	const prefetch = new HistoryPrefetch();
	const network = fakeClient();
	const opened = withPrefetchedHistory(network.client, prefetch);
	return { prefetch, network, opened };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("withPrefetchedHistory", () => {
	it("answers the opening thread's history reads from what was prefetched", async () => {
		const { prefetch, network, opened } = setup();
		prefetch.prefetch("ses_1", network.client);

		const [session, messages] = await Promise.all([
			opened.session.get({ sessionID: "ses_1" }),
			opened.message.list(FIRST_PAGE),
		]);

		expect(session).toEqual({ id: "ses_1" });
		expect(messages.data).toEqual([{ id: "msg_1" }]);
		expect(network.get).toHaveBeenCalledOnce();
		expect(network.messages).toHaveBeenCalledOnce();
	});

	it("serves each prefetched reply once; a later load reads the server", async () => {
		const { prefetch, network, opened } = setup();
		prefetch.prefetch("ses_1", network.client);
		await opened.message.list(FIRST_PAGE);

		await opened.message.list(FIRST_PAGE);

		expect(network.messages).toHaveBeenCalledTimes(2);
	});

	it("reads the server once an event for the chat dropped what was prefetched", async () => {
		const { prefetch, network, opened } = setup();
		prefetch.prefetch("ses_1", network.client);

		prefetch.invalidate("ses_1");
		await opened.message.list(FIRST_PAGE);

		expect(network.messages).toHaveBeenCalledTimes(2);
	});

	it("reads the server once what was prefetched is too old", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const { prefetch, network, opened } = setup();
		prefetch.prefetch("ses_1", network.client);

		vi.setSystemTime(Date.now() + PREFETCH_TTL_MS);
		await opened.session.get({ sessionID: "ses_1" });

		expect(network.get).toHaveBeenCalledTimes(2);
	});

	it("passes through every other read and write", async () => {
		const { prefetch, network, opened } = setup();
		prefetch.prefetch("ses_1", network.client);

		await opened.message.list({ sessionID: "ses_1", limit: 10 });
		await opened.message.list({ sessionID: "ses_1" });
		await opened.message.list({ ...FIRST_PAGE, cursor: "older" });
		await opened.session.get({ sessionID: "ses_other" });
		opened.session.prompt({ sessionID: "ses_1" } as never);

		expect(network.messages).toHaveBeenCalledTimes(4);
		expect(network.get).toHaveBeenCalledTimes(2);
		expect(network.prompt).toHaveBeenCalledOnce();
	});

	it("serves the history of whichever chat was prefetched", async () => {
		const { prefetch, network, opened } = setup();
		prefetch.prefetch("ses_2", network.client);

		await opened.message.list({ sessionID: "ses_2", limit: OPEN_CODE_HISTORY_PAGE_SIZE });
		await opened.message.list(FIRST_PAGE);

		expect(network.messages).toHaveBeenCalledTimes(2);
	});

	it("loads once however often the row is hovered", () => {
		const { prefetch, network } = setup();

		prefetch.prefetch("ses_1", network.client);
		prefetch.prefetch("ses_1", network.client);

		expect(network.messages).toHaveBeenCalledOnce();
	});

	it("lets the opening thread read the server after a prefetch failed", async () => {
		const { prefetch, network, opened } = setup();
		network.messages.mockRejectedValueOnce(new Error("offline"));
		prefetch.prefetch("ses_1", network.client);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const messages = await opened.message.list(FIRST_PAGE);

		expect(messages.data).toEqual([{ id: "msg_1" }]);
		expect(network.messages).toHaveBeenCalledTimes(2);
	});
});
