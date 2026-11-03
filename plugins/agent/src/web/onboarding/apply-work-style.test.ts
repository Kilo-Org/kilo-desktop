import { describe, expect, it } from "vitest";

import {
	applyWorkStyle,
	findConflictingPermissionKeys,
	type WorkStyleClient,
} from "./apply-work-style";
import { REVIEW_FIRST_PERMISSION, type PermissionConfig } from "./work-style-presets";

function createClient(permission?: PermissionConfig) {
	const calls: string[] = [];
	const updates: Array<{ config: { permission: PermissionConfig } }> = [];
	const client: WorkStyleClient = {
		global: {
			dispose: async () => {
				calls.push("dispose");
			},
			config: {
				get: async (opts) => {
					calls.push(`get:${opts?.throwOnError === true}`);
					return { data: permission ? { permission } : {} };
				},
				update: async (input, opts) => {
					calls.push(`update:${opts?.throwOnError === true}`);
					updates.push(input);
					return { data: {} };
				},
			},
		},
	};
	return { client, calls, updates };
}

describe("applyWorkStyle", () => {
	it("reads the global config, writes the review-first block, then reloads Kilo", async () => {
		const { client, calls, updates } = createClient();

		const result = await applyWorkStyle(client, "human-in-the-loop", null);

		expect(result.applied).not.toBeNull();
		expect(calls).toEqual(["get:true", "update:true", "dispose"]);
		expect(updates).toEqual([{ config: { permission: REVIEW_FIRST_PERMISSION } }]);
	});

	it("overrides existing rules for the preset keys", async () => {
		const { client, updates } = createClient({ bash: "allow", edit: "allow" });

		const result = await applyWorkStyle(client, "human-in-the-loop", null);

		expect(result.applied?.previous).toMatchObject({ bash: "allow", edit: "allow" });
		expect(updates[0]!.config.permission).toMatchObject({ edit: "ask", bash: { "*": "ask" } });
	});

	it("skips the write and the reload when there is nothing to change", async () => {
		const existing = createClient(structuredClone(REVIEW_FIRST_PERMISSION));
		await applyWorkStyle(existing.client, "human-in-the-loop", null);
		expect(existing.calls).toEqual(["get:true"]);

		const autonomous = createClient({ edit: "allow" });
		await expect(applyWorkStyle(autonomous.client, "autonomous", null)).resolves.toEqual({
			applied: null,
		});
		expect(autonomous.calls).toEqual(["get:true"]);
	});

	it("restores what it replaced when switching to high autonomy", async () => {
		const { client, calls, updates } = createClient(structuredClone(REVIEW_FIRST_PERMISSION));

		await expect(
			applyWorkStyle(client, "autonomous", { previous: { edit: "allow" } }),
		).resolves.toEqual({ applied: null });

		expect(calls).toEqual(["get:true", "update:true", "update:true", "dispose"]);
		expect(updates[0]!.config.permission).toMatchObject({ edit: null, bash: null, read: null });
		expect(updates[1]!.config.permission).toEqual({ edit: "allow" });
	});

	it("propagates a failed write and does not reload", async () => {
		const { client, calls } = createClient();
		client.global.config.update = async () => {
			calls.push("update");
			throw new Error("EACCES: kilo.jsonc");
		};

		await expect(applyWorkStyle(client, "human-in-the-loop", null)).rejects.toThrow(
			"EACCES: kilo.jsonc",
		);
		expect(calls).toEqual(["get:true", "update"]);
	});
});

describe("findConflictingPermissionKeys", () => {
	it("reports the preset keys the user's global config sets differently", async () => {
		await expect(findConflictingPermissionKeys(createClient().client)).resolves.toEqual([]);
		await expect(
			findConflictingPermissionKeys(createClient({ bash: "allow", mcp_tool: "allow" }).client),
		).resolves.toEqual(["bash"]);
	});
});
