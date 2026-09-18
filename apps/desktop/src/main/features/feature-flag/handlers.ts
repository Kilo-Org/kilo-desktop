import type { IpcHandlers } from "@kilo-desktop/contracts";

import type { FeatureFlagService } from "./service.js";

export function createFeatureFlagHandlers(
	service: FeatureFlagService,
): Pick<IpcHandlers, "feature-flag:get-all"> {
	return {
		"feature-flag:get-all": () => service.getAllFlags(),
	};
}
