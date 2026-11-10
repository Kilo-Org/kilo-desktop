import type { LocalModel } from "../../contracts";
import { hasLlamaFlagOverride } from "../../shared/settings/model-settings";
import { LLAMA_API_KEY_ENV, LOCAL_PROVIDER_NAME } from "./kilo-constants";

function available(models: readonly LocalModel[]): LocalModel[] {
	return models.filter((model) => model.available);
}

function renderPresetSection(model: LocalModel): string {
	const lines = [`[${model.id}]`, `model = ${model.path}`];
	const contextLength = model.settings?.contextLength;
	if (contextLength !== undefined && !hasLlamaFlagOverride(model.settings, "contextLength")) {
		lines.push(`ctx-size = ${String(contextLength)}`);
	}
	const flags = model.settings?.llamaFlags ?? {};
	for (const key of Object.keys(flags).toSorted()) {
		lines.push(`${key} = ${flags[key]}`);
	}
	return `${lines.join("\n")}\n`;
}

export function renderModelPreset(models: readonly LocalModel[]): string {
	return available(models).map(renderPresetSection).join("\n");
}

export function createProviderEntry(
	models: readonly LocalModel[],
	baseURL: string,
): Readonly<Record<string, unknown>> {
	return {
		npm: "@ai-sdk/openai-compatible",
		name: LOCAL_PROVIDER_NAME,
		options: {
			baseURL,
			headers: { Authorization: `Bearer {env:${LLAMA_API_KEY_ENV}}` },
		},
		models: Object.fromEntries(
			available(models).map((model) => [
				model.id,
				{
					name: model.name,
					modalities: { input: ["text"], output: ["text"] },
				},
			]),
		),
	};
}
