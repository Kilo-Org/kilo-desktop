// Builders for Kilo v2 data in the shapes the server sends (`@kilocode/client`
// types). Ids follow kilo2's prefixes; times come from a clock that ticks on
// every call and never runs behind real time, so a conversation sorts in the
// order it was built.
import type {
	FormInfo,
	PermissionRequest,
	SessionInfo,
	SessionMessageAssistant,
	SessionMessageAssistantReasoning,
	SessionMessageAssistantText,
	SessionMessageAssistantTool,
	SessionMessageIdle,
	SessionMessageSynthetic,
	SessionMessageUser,
	SessionStructuredError,
} from "@kilocode/client";

let clock = 0;
/** A creation time later than every earlier one. */
export function nextTime(): number {
	clock = Math.max(clock + 1, Date.now());
	return clock;
}

let sequence = 0;
/** A fresh id with kilo2's prefix (`ses`, `msg`, `per`, `frm`, `evt`, `call`). */
export function nextId(prefix: string): string {
	sequence += 1;
	return `${prefix}_${String(sequence).padStart(6, "0")}fake`;
}

export const TEST_MODEL = { providerID: "acme", id: "fast-1" } as const;

const ZERO_TOKENS = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };

export function session(
	id: string,
	patch: Partial<SessionInfo> & { readonly directory?: string } = {},
): SessionInfo {
	const { directory = "/projects/app", ...rest } = patch;
	const created = rest.time?.created ?? nextTime();
	return {
		id,
		projectID: "project",
		cost: 0,
		tokens: ZERO_TOKENS,
		title: `Chat ${id}`,
		location: { directory },
		...rest,
		time: { created, updated: created, ...rest.time },
	};
}

export function userMessage(
	text: string,
	patch: Partial<SessionMessageUser> = {},
): SessionMessageUser {
	return { id: nextId("msg"), type: "user", text, time: { created: nextTime() }, ...patch };
}

export function syntheticMessage(
	text: string,
	patch: Partial<SessionMessageSynthetic> = {},
): SessionMessageSynthetic {
	return { id: nextId("msg"), type: "synthetic", text, time: { created: nextTime() }, ...patch };
}

export function idleMessage(
	outcome: SessionMessageIdle["outcome"] = "succeeded",
	error?: SessionStructuredError,
): SessionMessageIdle {
	return {
		id: nextId("msg"),
		type: "idle",
		outcome,
		time: { created: nextTime() },
		...(error ? { error } : {}),
	};
}

export const text = (value: string): SessionMessageAssistantText => ({ type: "text", text: value });

export const reasoning = (value: string): SessionMessageAssistantReasoning => {
	const created = nextTime();
	return { type: "reasoning", text: value, time: { created, completed: created + 1 } };
};

/** A completed tool call; pass `error` for a failed one. */
export function tool(
	name: string,
	input: Record<string, unknown>,
	output: string | { readonly error: SessionStructuredError } = "",
	patch: Partial<SessionMessageAssistantTool> = {},
): SessionMessageAssistantTool {
	const created = nextTime();
	return {
		type: "tool",
		id: nextId("call"),
		name,
		executed: false,
		state:
			typeof output === "string"
				? {
						status: "completed",
						input: input as never,
						content: [{ type: "text", text: output }],
						metadata: {},
					}
				: { status: "error", input: input as never, error: output.error },
		time: { created, ran: created, completed: created + 1 },
		...patch,
	};
}

/** A finished model step (one assistant message) with `content`. */
export function assistantMessage(
	content: SessionMessageAssistant["content"],
	patch: Partial<SessionMessageAssistant> = {},
): SessionMessageAssistant {
	const created = nextTime();
	const hasTool = content.some((item) => item.type === "tool");
	return {
		id: nextId("msg"),
		type: "assistant",
		agent: "code",
		model: { ...TEST_MODEL, variant: "default" },
		content,
		time: { created, firstToken: created, streamed: created + 1, completed: created + 2 },
		finish: hasTool ? "tool-calls" : "stop",
		rawFinish: hasTool ? "tool_calls" : "stop",
		cost: 0,
		tokens: ZERO_TOKENS,
		...patch,
	};
}

export function permissionRequest(
	sessionID: string,
	patch: Partial<PermissionRequest> & Pick<PermissionRequest, "action">,
): PermissionRequest {
	return { id: nextId("per"), sessionID, resources: [], metadata: {}, ...patch };
}

/**
 * The question tool's form (`core/src/tool/plugin/question.ts`): one field
 * per question keyed `q0, q1, …`, options by label, custom answers allowed,
 * and the tool call it belongs to in its metadata.
 */
export function questionForm(
	sessionID: string,
	questions: readonly {
		readonly question: string;
		readonly header: string;
		readonly options: readonly (
			| string
			| { readonly label: string; readonly description?: string }
		)[];
		readonly multiple?: boolean;
	}[],
	patch: Partial<FormInfo> & { readonly tool?: { messageID: string; id: string } } = {},
): FormInfo {
	const { tool: toolCall, ...rest } = patch;
	return {
		id: nextId("frm"),
		sessionID,
		title: "Questions",
		metadata: { kind: "question", ...(toolCall ? { tool: toolCall } : {}) },
		fields: questions.map((question, index) => ({
			key: `q${index}`,
			title: question.header,
			description: question.question,
			type: question.multiple === true ? "multiselect" : "string",
			options: question.options.map((option) => {
				const { label, description } = typeof option === "string" ? { label: option } : option;
				return { value: label, label, ...(description ? { description } : {}) };
			}),
			custom: true,
		})) as never,
		...rest,
	};
}
