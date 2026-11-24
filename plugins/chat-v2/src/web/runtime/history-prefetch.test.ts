import { OPEN_CODE_HISTORY_PAGE_SIZE } from "@kilo-desktop/react-opencode-v2";
import type { KiloClient } from "@kilocode/sdk/v2/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HistoryPrefetch, PREFETCH_TTL_MS, withPrefetchedHistory } from "./history-prefetch";

/** The thread's first history read: its newest page. */
const FIRST_PAGE = { sessionID: "ses_1", limit: OPEN_CODE_HISTORY_PAGE_SIZE };

function fakeClient() {
	const get = vi.fn(async (parameters: { sessionID: string }) => ({
		data: { id: parameters.sessionID },
	}));
	const messages = vi.fn(async () => ({ data: [{ info: { id: "msg_1" } }] }));
	const prompt = vi.fn();
	return {
		client: { session: { get, messages, prompt } } as never as KiloClient,
		get,
		messages,
		prompt,
	};
}

function setup() {
	const prefetch = new HistoryPrefetch();
	const network = fakeClient();
	const opened = withPrefetchedHistory(network.client, "ses_1", prefetch);
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
			opened.session.messages(FIRST_PAGE),
		]);

		expect(session.data).toEqual({ id: "ses_1" });
		expect(messages.data).toEqual([{ info: { id: "msg_1" } }]);
		expect(network.get).toHaveBeenCalledOnce();
		expect(network.messages).toHaveBeenCalledOnce();
	});

	it("serves each prefetched reply once; a later load reads the server", async () => {
		const { prefetch, network, opened } = setup();
		prefetch.prefetch("ses_1", network.client);
		await opened.session.messages(FIRST_PAGE);

		await opened.session.messages(FIRST_PAGE);

		expect(network.messages).toHaveBeenCalledTimes(2);
	});

	it("reads the server once an event for the chat dropped what was prefetched", async () => {
		const { prefetch, network, opened } = setup();
		prefetch.prefetch("ses_1", network.client);

		prefetch.invalidate("ses_1");
		await opened.session.messages(FIRST_PAGE);

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

		await opened.session.messages({ sessionID: "ses_1", limit: 10 });
		await opened.session.messages({ sessionID: "ses_1" });
		await opened.session.messages({ ...FIRST_PAGE, before: "cursor" });
		await opened.session.get({ sessionID: "ses_other" });
		opened.session.prompt({ sessionID: "ses_1" } as never);

		expect(network.messages).toHaveBeenCalledTimes(4);
		expect(network.get).toHaveBeenCalledTimes(2);
		expect(network.prompt).toHaveBeenCalledOnce();
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

		const messages = await opened.session.messages(FIRST_PAGE);

		expect(messages.data).toEqual([{ info: { id: "msg_1" } }]);
		expect(network.messages).toHaveBeenCalledTimes(2);
	});
});
