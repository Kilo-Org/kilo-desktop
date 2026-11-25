import { describe, expect, it, vi } from "vitest";

import { OpenCodeThreadController } from "./index";

/**
 * Regression guard for Desktop's fork: human permission approvals
 * must send `interactive: true`. The Kilo server silently refuses non-reject
 * approvals of sensitive (skill-shell / sandbox-escalation) permissions unless
 * `interactive` is set, leaving them pending until a sibling reply sweeps them
 * to "rejected". Rejections deliberately omit `interactive`, mirroring the TUI.
 */
describe("OpenCodeThreadController.replyToPermission interactive flag", () => {
	const createController = () => {
		const reply = vi.fn(async (_body: Record<string, unknown>, _options?: unknown) => ({
			data: true,
		}));
		const client = { permission: { reply } } as never;
		const controller = new OpenCodeThreadController(client, () => ({}) as never, "session-1");
		return { controller, reply };
	};

	it("marks allow-once approvals as interactive", async () => {
		const { controller, reply } = createController();

		await controller.replyToPermission("permission-1", "once");

		expect(reply).toHaveBeenCalledWith(
			expect.objectContaining({ requestID: "permission-1", reply: "once", interactive: true }),
			expect.anything(),
		);
	});

	it("marks allow-always approvals as interactive", async () => {
		const { controller, reply } = createController();

		await controller.replyToPermission("permission-2", "always");

		expect(reply).toHaveBeenCalledWith(
			expect.objectContaining({ requestID: "permission-2", reply: "always", interactive: true }),
			expect.anything(),
		);
	});

	it("does not mark rejections as interactive", async () => {
		const { controller, reply } = createController();

		await controller.replyToPermission("permission-3", "reject");

		expect(reply).toHaveBeenCalledTimes(1);
		const body = reply.mock.calls[0]?.[0];
		expect(body).toMatchObject({ requestID: "permission-3", reply: "reject" });
		expect(body).not.toHaveProperty("interactive");
	});
});
