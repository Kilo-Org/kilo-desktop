import { describe, expect, it, vi } from "vitest";

import { createNotificationsHandlers } from "./handlers.js";

describe("createNotificationsHandlers", () => {
	it("delegates show and set-badge to the notifications service", () => {
		const notifications = {
			show: vi.fn(() => ({ delivered: true })),
			setBadge: vi.fn(() => ({ delivered: false, reason: "unsupported" })),
		};

		const handlers = createNotificationsHandlers(notifications as never);

		expect(handlers["notifications:show"]({ title: "Hi", message: "There", type: "info" })).toEqual(
			{ delivered: true },
		);
		expect(notifications.show).toHaveBeenCalledWith({
			title: "Hi",
			message: "There",
			type: "info",
		});

		expect(handlers["notifications:set-badge"]({ count: 4 })).toEqual({
			delivered: false,
			reason: "unsupported",
		});
		expect(notifications.setBadge).toHaveBeenCalledWith(4);
	});
});
