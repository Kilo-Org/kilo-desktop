import type { IpcHandlers } from "@kilo-desktop/contracts";

import type { DesktopUpdaterService } from "../../platform/Updater.js";

type UpdateChannels = Pick<IpcHandlers, "updates:get-state" | "updates:check" | "updates:install">;

export function createUpdateHandlers(updates: DesktopUpdaterService): UpdateChannels {
	return {
		"updates:get-state": () => updates.state,
		"updates:check": () => updates.check(),
		"updates:install": () => updates.install(),
	};
}
