import type { IpcHandlers } from "@anaconda-agentic-desktop/contracts";

import type { ElectronNotifications } from "../../platform/ElectronNotifications.js";

type NotificationChannels = Pick<IpcHandlers, "notifications:show" | "notifications:set-badge">;

export function createNotificationsHandlers(
	notifications: ElectronNotifications,
): NotificationChannels {
	return {
		"notifications:show": (input) => notifications.show(input),
		"notifications:set-badge": ({ count }) => notifications.setBadge(count),
	} satisfies NotificationChannels;
}
