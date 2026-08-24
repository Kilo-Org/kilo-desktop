export type KiloSuggestionAction = {
	label: string;
	description?: string | undefined;
	prompt: string;
};

export type KiloSuggestionRequest = {
	id: string;
	sessionID: string;
	text: string;
	actions: KiloSuggestionAction[];
	blocking?: boolean | undefined;
	tool?: { messageID: string; callID: string } | undefined;
};

export type KiloSuggestionEvent = {
	type: string;
	properties: Record<string, unknown>;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

const parseAction = (value: unknown): KiloSuggestionAction | undefined => {
	const record = asRecord(value);
	if (!record) return undefined;
	const label = asString(record.label);
	const prompt = asString(record.prompt);
	if (!label || !prompt) return undefined;
	const description = asString(record.description);
	return description ? { label, prompt, description } : { label, prompt };
};

export function parseSuggestionRequest(value: unknown): KiloSuggestionRequest | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	const id = asString(record.id);
	const sessionID = asString(record.sessionID);
	const text = asString(record.text);
	if (!id || !sessionID || !text || !Array.isArray(record.actions)) return undefined;
	const actions = record.actions.flatMap((action) => {
		const parsed = parseAction(action);
		return parsed ? [parsed] : [];
	});
	if (actions.length === 0) return undefined;

	const toolRecord = asRecord(record.tool);
	const messageID = asString(toolRecord?.messageID);
	const callID = asString(toolRecord?.callID);
	const tool = messageID && callID ? { messageID, callID } : undefined;
	const blocking = typeof record.blocking === "boolean" ? record.blocking : undefined;

	return {
		id,
		sessionID,
		text,
		actions,
		...(blocking === undefined ? {} : { blocking }),
		...(tool ? { tool } : {}),
	};
}

const requestIdFromEvent = (event: KiloSuggestionEvent): string | undefined =>
	asString(event.properties.requestID);

export function applySuggestionEvent(
	pending: readonly KiloSuggestionRequest[],
	event: KiloSuggestionEvent,
): readonly KiloSuggestionRequest[] | null {
	switch (event.type) {
		case "suggestion.shown": {
			const next = parseSuggestionRequest(event.properties);
			if (!next) return null;
			if (pending.some((request) => request.id === next.id)) return null;
			return [...pending, next];
		}
		case "suggestion.accepted":
		case "suggestion.dismissed": {
			const requestID = requestIdFromEvent(event);
			if (!requestID) return null;
			if (!pending.some((request) => request.id === requestID)) return null;
			return pending.filter((request) => request.id !== requestID);
		}
		default:
			return null;
	}
}

export function pickPendingSuggestion(
	pending: readonly KiloSuggestionRequest[],
	sessionId: string | undefined,
): KiloSuggestionRequest | null {
	if (!sessionId) return null;
	return pending.find((request) => request.sessionID === sessionId) ?? null;
}

/**
 * Whether the composer should show Stop instead of Send.
 *
 * Kilo's `suggest` tool keeps the OpenCode run streaming while it waits, but
 * the prompt must stay usable — VS Code's `isPromptBusy` treats a pending
 * suggestion as idle so the user can send another message (which dismisses it).
 */
export function isComposerPromptBusy(
	isRunning: boolean,
	pendingSuggestion: KiloSuggestionRequest | null,
): boolean {
	return isRunning && pendingSuggestion == null;
}

type StatusPart = {
	type: string;
	status?: { type: string } | undefined;
};

/**
 * True when a tool call or reasoning part is still running, so the activity
 * subgroup already shows live status (Delegating, Thinking, Running bash).
 */
export function messageHasInFlightActivity(parts: readonly StatusPart[]): boolean {
	return parts.some(
		(part) =>
			(part.type === "tool-call" || part.type === "reasoning") && part.status?.type === "running",
	);
}

/**
 * GroupedParts shows "Considering next steps" while the last assistant
 * message is still running. Hide it when a suggestion is waiting, or when a
 * tool / subgroup already owns the live status row.
 */
export function assistantWorkingIndicatorMode(
	pendingSuggestion: KiloSuggestionRequest | null,
	hasInFlightActivity: boolean,
): "never" | "no-text" {
	if (pendingSuggestion != null || hasInFlightActivity) return "never";
	return "no-text";
}
