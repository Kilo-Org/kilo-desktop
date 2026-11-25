import { BellIcon } from "lucide-react";

import type { PluginSdk } from "@kilo-desktop/kernel";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";

import { NotificationPreferences } from "../../contracts";

import {
	NOTIFICATION_PREFERENCES_STORAGE_KEY,
	notificationPreferences,
} from "./notification-preferences";
import { NotificationSettings } from "./NotificationSettings";
import { startChatNotifier } from "./start-notifier";

/**
 * The notifications area: Settings → Notifications (also a domain object, so
 * other plugins can show and flip a cue), and the sounds and
 * system notifications for chats' work (main window only, so pop-outs don't
 * double every cue).
 */
export function activateNotifications(sdk: PluginSdk): void {
	notificationPreferences.reload();
	const preferences = sdk.domainObjects.provide(NotificationPreferences, {
		initialState: notificationPreferences.get(),
		methods: {
			setMode: ({ cue, mode }) => notificationPreferences.setMode(cue, mode),
		},
	});
	notificationPreferences.subscribe(() => preferences.setState(notificationPreferences.get()));
	// Another window changed them: read storage again.
	globalThis.addEventListener?.("storage", (event) => {
		if (event.key === NOTIFICATION_PREFERENCES_STORAGE_KEY) notificationPreferences.reload();
	});
	sdk.extensions.implement(SettingsSection, "notifications", {
		component: NotificationSettings,
		icon: BellIcon,
	});
	if (!sdk.context.get("kernel/secondaryWindow")) startChatNotifier(sdk);
}
