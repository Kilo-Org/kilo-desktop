import type { ModelRef, PromptChatInput } from "../../../contracts";
import type { KiloModelRef, PromptFile } from "./kilo-chat-client";

/** Desktop's model reference as Kilo v2 names it (`Model.Ref`). */
export function wireModel(
	model: ModelRef & { readonly variant?: string | undefined },
): KiloModelRef {
	return {
		providerID: model.aiProviderId,
		id: model.modelId,
		...(model.variant ? { variant: model.variant } : {}),
	};
}

/**
 * A prompt's parts as one v2 prompt: its text parts joined (a v2 prompt has
 * one text) and its files by URL.
 */
export function wirePrompt(parts: PromptChatInput["parts"]): {
	readonly text: string;
	readonly files: PromptFile[];
} {
	const texts: string[] = [];
	const files: PromptFile[] = [];
	for (const part of parts) {
		if (part.type === "text") texts.push(part.text);
		else
			files.push({
				uri: part.url,
				...(part.filename !== undefined ? { name: part.filename } : {}),
			});
	}
	return { text: texts.join("\n\n"), files };
}
