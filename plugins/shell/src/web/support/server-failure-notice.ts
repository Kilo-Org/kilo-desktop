import type { PluginSdk } from "@kilo-desktop/kernel";
import { KiloServer, type ServerStatus } from "@kilo-desktop/plugin-core/contracts";

import { Notifications } from "../../contracts";

const NOTICE_ID = "server-failure";

/** The command the notice's Restart action runs. */
export const RESTART_SERVER_COMMAND = "kilo.shell/restart-server";

/**
 * Says when the Kilo server stops working: one notice, posted from the main
 * window (notices show in every window), replaced on each failure and
 * dismissed once the server is running again. Starting normally shows
 * nothing. Without kilo.shell's notifications (a browser build) it stays quiet.
 */
export function noticeServerFailures(sdk: PluginSdk): void {
	let posted = false;
	const notifications = () => sdk.domainObjects.get(Notifications);
	const report = (failure: Promise<unknown>) =>
		failure.catch((error: unknown) => sdk.logger.warn("Could not update the Kilo notice", error));

	const show = (status: ServerStatus) => {
		if (status.status === "ready" && posted) {
			posted = false;
			const handle = notifications();
			if (handle) void report(handle.methods.dismiss({ id: NOTICE_ID }));
			return;
		}
		if (status.status !== "error") return;
		const handle = notifications();
		if (!handle) return;
		posted = true;
		void report(
			handle.methods.post({
				id: NOTICE_ID,
				level: "error",
				title: "Kilo isn't running",
				...(status.message ? { description: status.message } : {}),
				action: { label: "Restart", command: RESTART_SERVER_COMMAND },
			}),
		);
	};

	let stop: (() => void) | undefined;
	sdk.domainObjects.track(KiloServer, {
		added(server) {
			show(server.getState());
			stop = server.subscribe(show);
		},
		removed() {
			stop?.();
			stop = undefined;
		},
	});
	sdk.onDispose(() => stop?.());
}
