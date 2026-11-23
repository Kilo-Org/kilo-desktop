import { describe, expect, it } from "vitest";

import { applyWorkStyle } from "./apply-work-style";
import { createFakeWorkStyleClient } from "./test-work-style-client";
import { REVIEW_FIRST_RULES } from "./work-style-presets";

describe("applyWorkStyle", () => {
	it("skips the write when there is nothing to change", async () => {
		const existing = createFakeWorkStyleClient(REVIEW_FIRST_RULES);
		await applyWorkStyle(existing.client, "human-in-the-loop", null);
		expect(existing.calls).toEqual(["read"]);

		const autonomous = createFakeWorkStyleClient([
			{ action: "edit", resource: "*", effect: "allow" },
		]);
		await expect(applyWorkStyle(autonomous.client, "autonomous", null)).resolves.toEqual({
			applied: null,
		});
		expect(autonomous.calls).toEqual(["read"]);
	});

	it("propagates a failed write", async () => {
		const fake = createFakeWorkStyleClient();
		fake.failNextWrite = new Error("EACCES: kilo2.jsonc");

		await expect(applyWorkStyle(fake.client, "human-in-the-loop", null)).rejects.toThrow(
			"EACCES: kilo2.jsonc",
		);
		expect(fake.calls).toEqual(["read", "write"]);
	});
});
