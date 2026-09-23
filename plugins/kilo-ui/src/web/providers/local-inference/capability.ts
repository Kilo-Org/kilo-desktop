export type LocalInferenceCapability = {
	prepareModel(modelId: string): Promise<void>;
	connect?: () => Promise<void>;
};

/** Returns the exposed capability itself (not a copy) so its identity is stable across renders. */
export function resolveLocalInferenceCapability(value: unknown): LocalInferenceCapability | null {
	if (!value || typeof value !== "object") return null;
	const capability = (value as Record<string, unknown>).localInference;
	if (!capability || typeof capability !== "object") return null;
	const record = capability as Record<string, unknown>;
	if (typeof record.prepareModel !== "function") return null;
	if (record.connect !== undefined && typeof record.connect !== "function") return null;
	return capability as LocalInferenceCapability;
}
