import { beforeEach, describe, expect, it, vi } from "vitest";

const electronNet = vi.hoisted(() => ({
	fetch: vi.fn(async () => new Response("ok")),
	request: vi.fn(),
}));

vi.mock("electron", () => ({ net: electronNet }));

import { HttpClient } from "./HttpClient.js";

describe("HttpClient", () => {
	beforeEach(() => vi.clearAllMocks());

	it("delegates fetch to Electron net and normalizes URL inputs", async () => {
		const init: RequestInit = { headers: { Authorization: "Basic redacted" } };
		const response = await new HttpClient().fetch(new URL("https://example.test/health"), init);

		expect(response).toBeInstanceOf(Response);
		expect(electronNet.fetch).toHaveBeenCalledWith("https://example.test/health", init);
	});
});
