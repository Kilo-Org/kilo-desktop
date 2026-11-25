import { describe, expect, it, vi } from "vitest";

import { OpenCodeThreadController } from "@kilo-desktop/react-opencode-v2";

/**
 * A person's permission reply goes to Kilo v2 as `permission.reply`'s
 * decision, naming the request's session. (v2 has no `interactive` flag: it
 * marks a request a person must decide itself, `metadata.interactive`.)
 */
describe("OpenCodeThreadController.replyToPermission", () => {
	const createController = () => {
		const reply = vi.fn(async (_body: Record<string, unknown>) => undefined);
		const client = { permission: { reply } } as never;
		const controller = new OpenCodeThreadController(client, () => ({}) as never, "session-1");
		return { controller, reply };
	};

	it.each(["once", "always", "reject"] as const)("sends %s as the decision", async (decision) => {
		const { controller, reply } = createController();

		await controller.replyToPermission("permission-1", decision);

		expect(reply).toHaveBeenCalledWith({
			sessionID: "session-1",
			requestID: "permission-1",
			decision,
		});
	});
});
