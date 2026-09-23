import { useQuery } from "@tanstack/react-query";

import { useSdk } from "@kilo-desktop/sdk-react";

/** Distinct from sdkQueryKey("models.list"), which caches the model array. */
export const INSTALLED_LOCAL_MODELS_QUERY_KEY = ["kilo-ui", "has-installed-local-models"] as const;

export function modelsIndicateInstalled(models: unknown): boolean {
	if (!Array.isArray(models)) return false;
	return models.some((model) => {
		if (!model || typeof model !== "object") return false;
		return (model as { available?: unknown }).available !== false;
	});
}

export function installedLocalModelsFromChangedPayload(payload: unknown): boolean | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const modelIds = (payload as { modelIds?: unknown }).modelIds;
	if (!Array.isArray(modelIds)) return undefined;
	return modelIds.length > 0;
}

export function useHasInstalledLocalModels(enabled: boolean): {
	hasInstalled: boolean;
	isPending: boolean;
} {
	const sdk = useSdk("local-inference");
	const query = useQuery({
		queryKey: INSTALLED_LOCAL_MODELS_QUERY_KEY,
		enabled,
		queryFn: async () => {
			try {
				return modelsIndicateInstalled(await sdk.invoke("models.list"));
			} catch {
				return false;
			}
		},
	});
	if (!enabled) return { hasInstalled: false, isPending: false };
	return {
		hasInstalled: query.data === true,
		isPending: query.isPending,
	};
}
