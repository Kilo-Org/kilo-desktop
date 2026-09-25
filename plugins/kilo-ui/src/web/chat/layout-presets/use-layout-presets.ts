import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSdk } from "@kilo-desktop/sdk-react";
import type { LayoutPresetsService } from "../../../contracts/layout-presets/schemas.js";

export const layoutPresetsQueryKey = ["kilo-ui", "layout-presets"] as const;

export function useLayoutPresets(enabled = true, subscribe = true) {
	const sdk = useSdk<LayoutPresetsService>("kilo-ui");
	const queryClient = useQueryClient();
	useEffect(() => {
		if (!enabled || !subscribe) return;
		return sdk.events.on("kilo-ui.layout-presets-changed", () => {
			void queryClient.invalidateQueries({ queryKey: layoutPresetsQueryKey });
		});
	}, [enabled, queryClient, sdk, subscribe]);
	return useQuery({
		queryKey: layoutPresetsQueryKey,
		queryFn: () => sdk.client["layoutPresets.get"](),
		enabled,
	});
}
