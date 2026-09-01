export type LocalInferenceCapability = {
	prepareModel(modelId: string): Promise<void>;
};

export function resolveLocalInferenceCapability(value: unknown): LocalInferenceCapability | null {
	if (!value || typeof value !== "object") return null;
	const capability = (value as Record<string, unknown>).localInference;
	if (!capability || typeof capability !== "object") return null;
	if (typeof (capability as Record<string, unknown>).prepareModel !== "function") return null;
	return capability as LocalInferenceCapability;
}
