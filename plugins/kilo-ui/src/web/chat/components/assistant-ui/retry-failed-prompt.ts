type PromptPart = {
	type: string;
	text?: string;
};

type PromptMessage = {
	id: string;
	role: string;
	content: readonly PromptPart[];
};

export function previousUserMessage<T extends { id: string; role: string }>(
	messages: readonly T[],
	assistantId: string,
): T | undefined {
	const index = messages.findIndex((message) => message.id === assistantId);
	if (index <= 0) return undefined;
	const previous = messages[index - 1];
	if (!previous || previous.role !== "user") return undefined;
	return previous;
}

export function userPromptText(message: { content: readonly PromptPart[] }): string | undefined {
	const text = message.content
		.flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
		.join("\n")
		.trim();
	return text || undefined;
}

/** Revert the failed turn when possible, then resubmit the previous user prompt. */
export async function retryFailedPrompt(input: {
	messages: readonly PromptMessage[];
	assistantId: string;
	revert?: (messageId: string) => Promise<void>;
	append: (text: string) => void;
}): Promise<boolean> {
	const user = previousUserMessage(input.messages, input.assistantId);
	if (!user) return false;
	const text = userPromptText(user);
	if (!text) return false;
	if (input.revert) {
		await input.revert(user.id).catch(() => undefined);
	}
	input.append(text);
	return true;
}
