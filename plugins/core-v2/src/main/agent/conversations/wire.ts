import type { ModelRef as KiloModelRef } from "@kilocode/client";

import type { ModelRef, PromptChatInput } from "../../../contracts";

/** A model, and the variant chosen for it, as Kilo names it. */
export function kiloModel(
	model: ModelRef & { readonly variant?: string | undefined },
): KiloModelRef {
	return {
		providerID: model.aiProviderId,
		id: model.modelId,
		...(model.variant ? { variant: model.variant } : {}),
	};
}

/** A prompt as Kilo takes it: one text, and files by URI. */
export function kiloPrompt(parts: PromptChatInput["parts"]): {
	text: string;
	files?: { uri: string; name?: string }[];
} {
	const text = parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
	const files = parts.flatMap((part) =>
		part.type === "file"
			? [{ uri: part.url, ...(part.filename !== undefined ? { name: part.filename } : {}) }]
			: [],
	);
	return { text, ...(files.length > 0 ? { files } : {}) };
}
