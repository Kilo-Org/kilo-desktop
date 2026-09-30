import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { sdkQueryKey, useSdk, useSdkMutation, useSdkQuery } from "@kilo-desktop/sdk-react";

import type {
	ModelPreferencesService,
	PersistedModelPreferences,
} from "../../../contracts/model-preferences/schemas.js";

type RememberInput = Parameters<ModelPreferencesService["modelPreferences.remember"]>[0];
type RecentInput = Parameters<ModelPreferencesService["modelPreferences.recordRecent"]>[0];

function nextRecents(current: PersistedModelPreferences | undefined, model: RecentInput) {
	const key = `${model.providerID}/${model.modelID}`;
	return [
		model,
		...(current?.recentModels ?? []).filter(
			(candidate) => `${candidate.providerID}/${candidate.modelID}` !== key,
		),
	].slice(0, 5);
}

export function useModelPreferences() {
	const sdk = useSdk<ModelPreferencesService>("kilo-ui");
	const queryClient = useQueryClient();
	const query = useSdkQuery(sdk, "modelPreferences.get");
	const { mutate } = useSdkMutation(sdk, "modelPreferences.remember", {
		invalidates: ["modelPreferences.get"],
	});
	const { mutate: mutateRecent } = useSdkMutation(sdk, "modelPreferences.recordRecent", {
		invalidates: ["modelPreferences.get"],
	});
	const remember = useCallback(
		(input: RememberInput) => {
			const variant = input.effort ?? "";
			queryClient.setQueryData<PersistedModelPreferences>(
				sdkQueryKey(sdk, "modelPreferences.get"),
				(current) => ({
					modelSelections: { ...current?.modelSelections, [input.agent]: input.model },
					preferred: { ...input.model, variant },
					variantSelections: {
						...current?.variantSelections,
						[`${input.agent}/${input.model.providerID}/${input.model.modelID}`]: variant,
					},
					recentModels: nextRecents(current, input.model),
					autoFreeModelsEnabled: current?.autoFreeModelsEnabled ?? true,
				}),
			);
			mutate(input);
		},
		[mutate, queryClient, sdk],
	);
	const recordRecent = useCallback(
		(model: RecentInput) => {
			queryClient.setQueryData<PersistedModelPreferences>(
				sdkQueryKey(sdk, "modelPreferences.get"),
				(current) => ({
					modelSelections: current?.modelSelections ?? {},
					...(current?.preferred ? { preferred: current.preferred } : {}),
					variantSelections: current?.variantSelections ?? {},
					recentModels: nextRecents(current, model),
					autoFreeModelsEnabled: current?.autoFreeModelsEnabled ?? true,
				}),
			);
			mutateRecent(model);
		},
		[mutateRecent, queryClient, sdk],
	);

	return {
		preferences: query.data,
		remember,
		recordRecent,
	};
}

/** Reads/writes `autoFreeModelsEnabled`; no consumer yet (see schema note). */
export function useAutoFreeModels() {
	const sdk = useSdk<ModelPreferencesService>("kilo-ui");
	const queryClient = useQueryClient();
	const query = useSdkQuery(sdk, "modelPreferences.get");
	const { mutate } = useSdkMutation(sdk, "modelPreferences.setAutoFreeEnabled", {
		invalidates: ["modelPreferences.get"],
	});
	const setAutoFreeEnabled = useCallback(
		(enabled: boolean) => {
			queryClient.setQueryData<PersistedModelPreferences>(
				sdkQueryKey(sdk, "modelPreferences.get"),
				(current) =>
					current
						? { ...current, autoFreeModelsEnabled: enabled }
						: {
								modelSelections: {},
								variantSelections: {},
								recentModels: [],
								autoFreeModelsEnabled: enabled,
							},
			);
			mutate(enabled);
		},
		[mutate, queryClient, sdk],
	);

	return {
		autoFreeModelsEnabled: query.data?.autoFreeModelsEnabled ?? true,
		setAutoFreeEnabled,
	};
}
