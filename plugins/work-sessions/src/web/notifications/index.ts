import { BellIcon } from "lucide-react";

import type { PluginSdk } from "@kilo-desktop/kernel";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";

import { notificationPreferences } from "./notification-preferences";
import { NotificationSettings } from "./NotificationSettings";
import { startChatNotifier } from "./start-notifier";

/**
 * The notifications area: Settings → Notifications, and the sounds and
 * system notifications for chats' work (main window only, so pop-outs don't
 * double every cue).
 */
export function activateNotifications(sdk: PluginSdk): void {
	notificationPreferences.reload();
	sdk.extensions.implement(SettingsSection, "notifications", {
		component: NotificationSettings,
		icon: BellIcon,
	});
	if (!sdk.context.get("kernel/secondaryWindow")) startChatNotifier(sdk);
}
