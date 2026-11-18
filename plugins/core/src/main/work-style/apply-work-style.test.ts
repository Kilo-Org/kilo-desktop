import { describe, expect, it } from "vitest";

import { applyWorkStyle } from "./apply-work-style";
import { createFakeWorkStyleClient } from "./test-work-style-client";
import { REVIEW_FIRST_PERMISSION } from "./work-style-presets";

describe("applyWorkStyle", () => {
	it("skips the write and the reload when there is nothing to change", async () => {
		const existing = createFakeWorkStyleClient(REVIEW_FIRST_PERMISSION);
		await applyWorkStyle(existing.client, "human-in-the-loop", null);
		expect(existing.calls).toEqual(["read"]);

		const autonomous = createFakeWorkStyleClient({ edit: "allow" });
		await expect(applyWorkStyle(autonomous.client, "autonomous", null)).resolves.toEqual({
			applied: null,
		});
		expect(autonomous.calls).toEqual(["read"]);
	});

	it("propagates a failed write and does not reload", async () => {
		const fake = createFakeWorkStyleClient();
		fake.failNextUpdate = new Error("EACCES: kilo.jsonc");

		await expect(applyWorkStyle(fake.client, "human-in-the-loop", null)).rejects.toThrow(
			"EACCES: kilo.jsonc",
		);
		expect(fake.calls).toEqual(["read", "update"]);
	});
});
