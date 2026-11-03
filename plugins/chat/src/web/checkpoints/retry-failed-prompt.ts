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

/**
 * Retry a failed turn. With a `retry` callback (server-backed session) the
 * turn is re-prompted in place through the previous user message id — no
 * revert, no duplicate prompt. Without one (local runtime / tests) the
 * previous user prompt is appended as a fresh turn. The tail guard keeps the
 * retry target unambiguous: only the failed assistant message at the very end
 * of the thread can be retried.
 */
export async function retryFailedPrompt(input: {
	messages: readonly PromptMessage[];
	assistantId: string;
	retry?: (userMessageId: string) => Promise<void>;
	append: (text: string) => void;
}): Promise<boolean> {
	const user = previousUserMessage(input.messages, input.assistantId);
	if (!user) return false;
	const last = input.messages[input.messages.length - 1];
	if (!last || last.id !== input.assistantId) return false;
	if (input.retry) {
		await input.retry(user.id);
		return true;
	}
	const text = userPromptText(user);
	if (!text) return false;
	input.append(text);
	return true;
}
