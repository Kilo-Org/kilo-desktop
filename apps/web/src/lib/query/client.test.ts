import { describe, expect, it } from "vitest";

import { LocalApiError } from "@anaconda-agentic-desktop/contracts";

import { createDesktopQueryClient } from "./client";

describe("createDesktopQueryClient", () => {
	it("retries once for TRANSPORT and INTERNAL LocalApiError", () => {
		const client = createDesktopQueryClient();
		const retry = client.getDefaultOptions().queries?.retry;
		expect(typeof retry).toBe("function");
		if (typeof retry !== "function") return;

		expect(retry(0, new LocalApiError("TRANSPORT", "boom"))).toBe(true);
		expect(retry(0, new LocalApiError("INTERNAL", "boom"))).toBe(true);
		expect(retry(1, new LocalApiError("TRANSPORT", "boom"))).toBe(false);
		expect(retry(0, new LocalApiError("VALIDATION", "nope"))).toBe(false);
		expect(retry(0, new Error("other"))).toBe(false);
	});

	it("disables mutation retries", () => {
		const client = createDesktopQueryClient();
		expect(client.getDefaultOptions().mutations?.retry).toBe(false);
	});
});
