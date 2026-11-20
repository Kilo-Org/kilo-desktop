import type { ModelRef, PromptChatInput } from "../../../contracts";

/** A model as the Kilo server's prompt endpoints name it. */
export function wireModel(model: ModelRef): { providerID: string; modelID: string } {
	return { providerID: model.aiProviderId, modelID: model.modelId };
}

/** Prompt parts in the server's shape: text, and files by URL. */
export function wireParts(parts: PromptChatInput["parts"]): Record<string, unknown>[] {
	return parts.map((part) =>
		part.type === "text"
			? { type: "text", text: part.text }
			: {
					type: "file",
					mime: part.mime,
					url: part.url,
					...(part.filename !== undefined ? { filename: part.filename } : {}),
				},
	);
}
