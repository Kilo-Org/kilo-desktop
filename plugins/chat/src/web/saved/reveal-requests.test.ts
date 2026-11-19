import { describe, expect, it } from "vitest";

import { RevealRequests } from "./reveal-requests";

describe("RevealRequests", () => {
	it("cancels a chat's untaken request as unavailable, so a later open doesn't act on it", async () => {
		const requests = new RevealRequests();
		const pending = requests.request("chat-1", "latest");

		requests.cancel("chat-1");

		expect(await pending).toBe("unavailable");
		expect(requests.take("chat-1")).toBeNull();
	});

	it("leaves another chat's request alone", () => {
		const requests = new RevealRequests();
		void requests.request("chat-1", "latest");

		requests.cancel("chat-2");

		expect(requests.take("chat-1")?.chatId).toBe("chat-1");
	});
});
