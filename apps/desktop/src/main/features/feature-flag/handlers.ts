import type { IpcHandlers } from "@anaconda-agentic-desktop/contracts";

import type { FeatureFlagService } from "./service.js";

export function createFeatureFlagHandlers(
	service: FeatureFlagService,
): Pick<IpcHandlers, "feature-flag:get-all" | "feature-flag:get"> {
	return {
		"feature-flag:get-all": () => service.getAllFlags(),
		"feature-flag:get": (input) => service.getFlag(input.key, input.defaultValue),
	};
}
