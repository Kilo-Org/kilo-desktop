import type { PluginSdk } from "@kilo-desktop/kernel";
import { Notifications, type NotificationContent } from "@kilo-desktop/plugin-shell/contracts";

/*
 * Toasts for what a person did (a click, a command): failures and outcomes
 * go through kilo.shell's notifications, to this window. The window area
 * binds the sdk once at activation, so plain functions and components report
 * the same way; without kilo.shell a toast is only logged.
 */

let bound: PluginSdk | null = null;

/** Binds toasts to this window's sdk; returns the unbinding. */
export function bindFailureReports(sdk: PluginSdk): () => void {
	bound = sdk;
	return () => {
		if (bound === sdk) bound = null;
	};
}

/** Shows a toast in this window. */
export function notify(content: NotificationContent): void {
	const sdk = bound;
	const notifications = sdk?.domainObjects.get(Notifications);
	if (!notifications) {
		sdk?.logger.warn(content.title, content.description);
		return;
	}
	void notifications.methods
		.toast(content)
		.catch((failure: unknown) => sdk?.logger.warn(content.title, failure));
}

/** A rejection handler that toasts `message`, with the error's message or `fallback` beneath. */
export function reportFailure(message: string, fallback: string): (error: unknown) => void {
	return (error) =>
		notify({
			level: "error",
			title: message,
			description: error instanceof Error ? error.message : fallback,
		});
}
