import { type DomainObjectProvider, type PluginSdk } from "@kilo-desktop/kernel";

import { Navigation, Notifications, type Notice } from "../contracts";
import { createWindowTarget } from "./window-target";

export interface NotificationsOptions {
	readonly now?: () => number;
	readonly newId?: () => string;
}

/**
 * Toasts and notices, in main so main-process plugins can raise them too. A
 * toast is only an event for one window (resolved like navigation requests;
 * windows with a frame are those navigation knows). Notices are state: each
 * is keyed `<plugin>/<id>`, so a plugin posting the same id replaces its own
 * notice and never another plugin's. `dismiss` takes that key, or the
 * caller's own id.
 */
export function provideNotifications(sdk: PluginSdk, options: NotificationsOptions = {}): void {
	const now = options.now ?? Date.now;
	const newId = options.newId ?? (() => crypto.randomUUID());
	const target = createWindowTarget(sdk, {
		frameWindows: () => Object.keys(sdk.domainObjects.get(Navigation)?.getState().windows ?? {}),
	});

	const notifications: DomainObjectProvider<typeof Notifications> = sdk.domainObjects.provide(
		Notifications,
		{
			initialState: { notices: {} },
			methods: {
				toast: ({ windowId, ...content }, caller) => {
					notifications.emit("toast", {
						...content,
						windowId: target(windowId, caller),
						pluginId: caller.pluginId,
					});
				},
				post: ({ id, ...content }, caller) => {
					const key = `${caller.pluginId}/${id ?? newId()}`;
					const notice: Notice = {
						...content,
						id: key,
						pluginId: caller.pluginId,
						createdAt: now(),
					};
					notifications.setState({ notices: { ...notifications.state.notices, [key]: notice } });
					return key;
				},
				dismiss: ({ id }, caller) => {
					const { notices } = notifications.state;
					const key = id in notices ? id : `${caller.pluginId}/${id}`;
					const { [key]: dismissed, ...rest } = notices;
					if (dismissed) notifications.setState({ notices: rest });
				},
			},
		},
	);
}
