import { describe, expect, it } from "vitest";

import { applyWorkStyle, findConflictingPermissionKeys } from "./apply-work-style";
import { createFakeWorkStyleClient } from "./test-work-style-client";
import { REVIEW_FIRST_PERMISSION } from "./work-style-presets";

describe("applyWorkStyle", () => {
	it("reads the global config, writes the review-first block, then reloads Kilo", async () => {
		const fake = createFakeWorkStyleClient();

		const result = await applyWorkStyle(fake.client, "human-in-the-loop", null);

		expect(result.applied).not.toBeNull();
		expect(fake.calls).toEqual(["read", "update", "dispose"]);
		expect(fake.updates).toEqual([REVIEW_FIRST_PERMISSION]);
	});

	it("overrides existing rules for the preset keys", async () => {
		const fake = createFakeWorkStyleClient({ bash: "allow", edit: "allow" });

		const result = await applyWorkStyle(fake.client, "human-in-the-loop", null);

		expect(result.applied?.previous).toMatchObject({ bash: "allow", edit: "allow" });
		expect(fake.updates[0]).toMatchObject({ edit: "ask", bash: { "*": "ask" } });
	});

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

	it("restores what it replaced when switching to high autonomy", async () => {
		const fake = createFakeWorkStyleClient(REVIEW_FIRST_PERMISSION);

		await expect(
			applyWorkStyle(fake.client, "autonomous", { previous: { edit: "allow" } }),
		).resolves.toEqual({ applied: null });

		expect(fake.calls).toEqual(["read", "update", "update", "dispose"]);
		expect(fake.updates[0]).toMatchObject({ edit: null, bash: null, read: null });
		expect(fake.updates[1]).toEqual({ edit: "allow" });
		expect(fake.permission).toEqual({ edit: "allow" });
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

describe("findConflictingPermissionKeys", () => {
	it("reports the preset keys the user's global config sets differently", async () => {
		await expect(
			findConflictingPermissionKeys(createFakeWorkStyleClient().client),
		).resolves.toEqual([]);
		await expect(
			findConflictingPermissionKeys(
				createFakeWorkStyleClient({ bash: "allow", mcp_tool: "allow" }).client,
			),
		).resolves.toEqual(["bash"]);
	});
});
