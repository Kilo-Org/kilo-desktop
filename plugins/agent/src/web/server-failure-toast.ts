import type { PluginSdk } from "@kilo-desktop/kernel";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { AgentServer, type ServerStatus } from "../contracts";

const TOAST_ID = "kilo.agent/server-failure";

/**
 * Says when the Kilo server stops working, until something shows it in the status bar. One
 * toast, replaced on each failure and dismissed once the server is running;
 * starting normally shows nothing.
 */
export function toastServerFailures(sdk: PluginSdk): void {
	let stop: (() => void) | undefined;
	sdk.domains.track(AgentServer, {
		added(server) {
			const show = (status: ServerStatus) => {
				if (status.status === "ready") {
					toast.dismiss(TOAST_ID);
					return;
				}
				if (status.status !== "error") return;
				toast.error("Kilo isn't running", {
					id: TOAST_ID,
					duration: Number.POSITIVE_INFINITY,
					...(status.message ? { description: status.message } : {}),
					action: {
						label: "Restart",
						onClick: () => void server.methods.restart(undefined).catch(() => undefined),
					},
				});
			};
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
