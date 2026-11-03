export type LocalModelLoadingStatus =
	| { status: "idle" }
	| { status: "preparing-runtime" }
	| { status: "starting" }
	| { status: "ready"; loadedModelId?: string }
	| { status: "loading-model"; modelId: string }
	| { status: "error"; message: string };

export type LocalModelLoadingCopy = {
	title: string;
	subtitle: string;
};

export const LOCAL_MODEL_LOADING_TITLE = "Loading model...";

export function isLocalModelLoadingStatus(
	status: LocalModelLoadingStatus | null,
): status is { status: "loading-model"; modelId: string } {
	return status?.status === "loading-model";
}

export function localModelLoadingCopy(
	status: LocalModelLoadingStatus,
	modelName?: string,
): LocalModelLoadingCopy | null {
	if (status.status === "loading-model") {
		return { title: LOCAL_MODEL_LOADING_TITLE, subtitle: modelName ?? status.modelId };
	}
	return null;
}

export function resolveLocalModelName(
	modelId: string,
	catalog: ReadonlyArray<{ modelID: string; name: string }> = [],
): string {
	return catalog.find((model) => model.modelID === modelId)?.name ?? modelId;
}

export function parseLocalInferenceStatus(payload: unknown): LocalModelLoadingStatus | null {
	if (!payload || typeof payload !== "object") return null;
	const status = (payload as { status?: unknown }).status;
	if (status === "idle" || status === "disconnected" || status === "stopping") {
		return { status: "idle" };
	}
	if (status === "preparing-runtime") return { status: "preparing-runtime" };
	if (status === "starting") return { status: "starting" };
	if (status === "ready") {
		const loadedModelId = (payload as { loadedModelId?: unknown }).loadedModelId;
		if (typeof loadedModelId === "string" && loadedModelId.length > 0) {
			return { status: "ready", loadedModelId };
		}
		return { status: "ready" };
	}
	if (status === "loading-model") {
		const modelId = (payload as { modelId?: unknown }).modelId;
		if (typeof modelId !== "string" || modelId.length === 0) return null;
		return { status: "loading-model", modelId };
	}
	if (status === "error") {
		const message = (payload as { message?: unknown }).message;
		if (typeof message !== "string" || message.length === 0) return null;
		return { status: "error", message };
	}
	return null;
}
