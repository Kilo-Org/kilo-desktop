import { useMemo } from "react";

import type { DomainHandle } from "@kilo-desktop/kernel";
import { useDomainState } from "@kilo-desktop/kernel/web";
import type {
	ModelSourceImplementation,
	ModelSourceState,
} from "@kilo-desktop/plugin-chat/contracts";

import { LocalInference, type LocalInferenceState } from "../contracts/index.js";
import { parseLocalInferenceStatus } from "./local-model-loading-copy.js";

const PENDING: ModelSourceState = { status: null, modelIds: [], pending: true };

const selectStatus = (state: LocalInferenceState) => state.status;
const selectModelIds = (state: LocalInferenceState) =>
	state.models
		.filter((model) => model.available)
		.map((model) => model.id)
		.join("\n");

function useLocalModelSourceState(): ModelSourceState {
	const status = useDomainState(LocalInference, selectStatus);
	const modelIds = useDomainState(LocalInference, selectModelIds);
	return useMemo(
		() =>
			status === null || status === undefined || modelIds === null || modelIds === undefined
				? PENDING
				: {
						status: parseLocalInferenceStatus(status),
						modelIds: modelIds ? modelIds.split("\n") : [],
						pending: false,
					},
		[status, modelIds],
	);
}

/**
 * The Local Model Server in the composer (`kilo.chat/model-source`): its
 * status and installed models for the picker's rail, Start when the rail is
 * chosen, and loading a model before a prompt for it is sent.
 */
export function localModelSource(
	domain: () => DomainHandle<typeof LocalInference> | null,
): ModelSourceImplementation {
	const methods = () => {
		const handle = domain();
		if (!handle) throw new Error("The Local Model Server is unavailable.");
		return handle.methods;
	};
	return {
		useState: useLocalModelSourceState,
		start: async () => {
			await methods().connect(undefined);
		},
		prepare: async (modelId) => {
			await methods().prepare({ modelId });
		},
	};
}
