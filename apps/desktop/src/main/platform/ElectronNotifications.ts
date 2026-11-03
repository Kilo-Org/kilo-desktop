import { app, Notification, type App } from "electron";

/**
 * Delivery is best-effort: `delivered: false` + `reason` reports expected
 * capability absence (unsupported platform, permission denied) instead of throwing.
 */
export interface NotificationDeliveryResult {
	readonly delivered: boolean;
	readonly reason?: string;
}

/** Structural surface of an OS notification so tests can inject a fake. */
export interface SystemNotificationLike {
	show(): void;
}

export interface ShowNotificationInput {
	title: string;
	message: string;
	/** Reserved for styling/urgency mapping; the OS toast renders title+body. */
	type: "info" | "success" | "warning" | "error";
	/** Mute the OS sound (macOS plays one by default), for callers with their own cue. */
	silent?: boolean | undefined;
}

/**
 * OS notifications + dock/taskbar badge for `sdk.notifications`.
 * Delivery is best-effort and reported honestly in the result envelope —
 * expected capability absence (unsupported platform) is a `delivered: false`
 * result, never a throw.
 */
export class ElectronNotifications {
	constructor(
		private readonly electronApp: App = app,
		private readonly isSupported: () => boolean = () => Notification.isSupported(),
		private readonly createNotification: (options: {
			title: string;
			body: string;
			silent: boolean;
		}) => SystemNotificationLike = (options) => new Notification(options),
	) {}

	show(input: ShowNotificationInput): NotificationDeliveryResult {
		if (!this.isSupported()) {
			return { delivered: false, reason: "OS notifications are not supported on this system." };
		}
		try {
			this.createNotification({
				title: input.title,
				body: input.message,
				silent: input.silent ?? false,
			}).show();
			return { delivered: true };
		} catch {
			return { delivered: false, reason: "The OS notification could not be shown." };
		}
	}

	setBadge(count: number): NotificationDeliveryResult {
		const applied = this.electronApp.setBadgeCount(count);
		return applied
			? { delivered: true }
			: { delivered: false, reason: "Badge counts are not supported on this platform." };
	}
}
