import type { IpcHandlers } from "@kilo-desktop/contracts";

import type { DesktopUpdaterService } from "../../platform/Updater.js";

type UpdateChannels = Pick<
	IpcHandlers,
	"updates:get-state" | "updates:check" | "updates:set-track" | "updates:install"
>;

export interface UpdateHandlerOptions {
	/** Whether the `update-track-switcher` feature flag currently allows changing tracks. */
	readonly isTrackSwitchingEnabled: () => boolean;
}

export function createUpdateHandlers(
	updates: Pick<DesktopUpdaterService, "state" | "check" | "setTrack" | "install">,
	{ isTrackSwitchingEnabled }: UpdateHandlerOptions,
): UpdateChannels {
	return {
		"updates:get-state": () => updates.state,
		"updates:check": () => updates.check(),
		"updates:set-track": (track) => {
			if (isTrackSwitchingEnabled()) return updates.setTrack(track);
			return {
				accepted: false,
				state: { ...updates.state, message: "Switching update tracks is not enabled." },
			};
		},
		"updates:install": () => updates.install(),
	};
}
