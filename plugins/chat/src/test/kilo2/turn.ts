// Drives one turn of a fake kilo2 chat: every call publishes the events kilo2
// publishes and folds them into the stored messages the way kilo2's
// projection does (`core/src/session/message-updater.ts`), so a transcript
// built from the stream and one loaded from `message.list` agree.
import type {
	ModelRef,
	SessionMessageAssistant,
	SessionMessageAssistantTool,
	SessionStructuredError,
	TokenUsageInfo,
} from "@kilocode/client";

import { idleMessage, nextId, nextTime } from "./fixtures";

/** What a turn needs from the fake server. */
export interface TurnHost {
	publish(sessionID: string, type: string, data: Record<string, unknown>): void;
	append(
		sessionID: string,
		message: SessionMessageAssistant | ReturnType<typeof idleMessage>,
	): void;
	/** Adds a step's tokens and cost to the chat's totals, returning the totals. */
	addUsage(
		sessionID: string,
		tokens: TokenUsageInfo,
		cost: number,
	): { tokens: TokenUsageInfo; cost: number };
	settle(sessionID: string, outcome: "succeeded" | "failed" | "interrupted"): void;
}

type Native = Record<string, string | number | boolean | null>;

export interface PartOptions {
	readonly deltas?: readonly string[];
	/** Provider-specific detail kilo2 keeps on the part (e.g. `{ reasoningField }`). */
	readonly native?: Native;
}

export const STEP_TOKENS: TokenUsageInfo = {
	input: 100,
	output: 20,
	reasoning: 0,
	cache: { read: 0, write: 0 },
};

/** A tool call that has been called and not yet answered. */
export interface RunningTool {
	readonly id: string;
	progress(metadata: Record<string, unknown>): void;
	succeed(output: string, metadata?: Record<string, unknown>): void;
	fail(error: SessionStructuredError): void;
}

export class Step {
	readonly message: SessionMessageAssistant;
	#ended = false;

	constructor(
		private readonly host: TurnHost,
		private readonly sessionID: string,
		agent: string,
		model: ModelRef,
	) {
		const started = nextTime();
		this.message = {
			id: nextId("msg"),
			type: "assistant",
			agent,
			model,
			content: [],
			time: { created: started },
		};
		host.append(sessionID, this.message);
		this.#publish("session.step.started", { agent, model, started });
		this.message.time.firstToken = nextTime();
		this.#publish("session.step.first-token", {});
	}

	#publish(type: string, data: Record<string, unknown>) {
		this.host.publish(this.sessionID, type, { assistantMessageID: this.message.id, ...data });
	}

	#ordinal(type: "text" | "reasoning") {
		return this.message.content.filter((item) => item.type === type).length;
	}

	/**
	 * A text part, streamed in `deltas` (kilo2 sends a part that arrives
	 * whole as one delta). Ordinals count parts of the same type.
	 */
	text(value: string, options: PartOptions = {}): this {
		const ordinal = this.#ordinal("text");
		const part: { type: "text"; text: string; native?: Native } = { type: "text", text: "" };
		this.message.content.push(part);
		this.#publish("session.text.started", { ordinal });
		for (const delta of options.deltas ?? [value]) {
			this.#publish("session.text.delta", { ordinal, delta });
		}
		part.text = value;
		if (options.native) part.native = options.native;
		this.#publish("session.text.ended", {
			ordinal,
			text: value,
			...(options.native ? { native: options.native } : {}),
		});
		return this;
	}

	reasoning(value: string, options: PartOptions = {}): this {
		const ordinal = this.#ordinal("reasoning");
		const created = nextTime();
		const native = options.native ? { native: options.native } : {};
		const part = { type: "reasoning" as const, text: "", ...native, time: { created } };
		this.message.content.push(part);
		this.#publish("session.reasoning.started", { ordinal, ...native });
		for (const delta of options.deltas ?? [value]) {
			this.#publish("session.reasoning.delta", { ordinal, delta });
		}
		Object.assign(part, { text: value, time: { created, completed: nextTime() } });
		this.#publish("session.reasoning.ended", { ordinal, text: value, ...native });
		return this;
	}

	/** Starts a tool call: its input streams and it is called; answer it with the returned handle. */
	call(name: string, input: Record<string, unknown>, id = nextId("call")): RunningTool {
		const part: SessionMessageAssistantTool = {
			type: "tool",
			id,
			name,
			state: { status: "streaming", input: "" },
			time: { created: nextTime() },
		};
		this.message.content.push(part);
		const inputText = JSON.stringify(input);
		// kilo2 publishes no input deltas for a call whose input arrives whole.
		this.#publish("session.tool.input.started", { id, name });
		part.state = { status: "streaming", input: inputText };
		this.#publish("session.tool.input.ended", { id, text: inputText });
		part.executed = false;
		part.time.ran = nextTime();
		part.state = { status: "running", input: input as never, metadata: {} };
		this.#publish("session.tool.called", { id, input, executed: false });
		const publish = (type: string, data: Record<string, unknown>) =>
			this.#publish(type, { id, ...data });
		return {
			id,
			progress: (metadata) => {
				if (part.state.status === "running") part.state.metadata = metadata as never;
				publish("session.tool.progress", { metadata });
			},
			succeed: (output, metadata = {}) => {
				const content: [{ type: "text"; text: string }] = [{ type: "text", text: output }];
				part.time.completed = nextTime();
				part.state = {
					status: "completed",
					input: input as never,
					content,
					metadata: metadata as never,
				};
				publish("session.tool.success", { content, metadata, executed: false });
			},
			fail: (error) => {
				part.time.completed = nextTime();
				part.state = { status: "error", input: input as never, error };
				publish("session.tool.failed", { error, executed: false });
			},
		};
	}

	/** A tool call answered at once. */
	tool(name: string, input: Record<string, unknown>, output: string, id?: string): this {
		this.call(name, input, id).succeed(output);
		return this;
	}

	/** Ends the step; `tool-calls` when it called a tool, else `stop`. */
	end(options: { readonly tokens?: TokenUsageInfo; readonly cost?: number } = {}): void {
		if (this.#ended) return;
		this.#ended = true;
		const tokens = options.tokens ?? STEP_TOKENS;
		const cost = options.cost ?? 0;
		const finish = this.message.content.some((item) => item.type === "tool")
			? "tool-calls"
			: "stop";
		const rawFinish = finish === "tool-calls" ? "tool_calls" : "stop";
		this.message.time.streamed = nextTime();
		this.#publish("session.step.streamed", {});
		Object.assign(this.message, { finish, rawFinish, tokens, cost });
		this.message.time.completed = nextTime();
		this.#publish("session.step.ended", { finish, rawFinish, tokens, cost });
		const totals = this.host.addUsage(this.sessionID, tokens, cost);
		this.host.publish(this.sessionID, "session.usage.updated", totals);
	}

	/** The step failed (the model errored). */
	failed(error: SessionStructuredError): void {
		if (this.#ended) return;
		this.#ended = true;
		Object.assign(this.message, { finish: "error", error });
		this.message.time.completed = nextTime();
		this.#publish("session.step.failed", { error });
	}
}

/**
 * A turn in progress (`session.execution.started` was published). Add steps,
 * then end it with `succeed`, `fail` or `interrupt`.
 */
export class Turn {
	#step: Step | undefined;
	#done = false;

	constructor(
		private readonly host: TurnHost,
		readonly sessionID: string,
		private readonly agent: string,
		private readonly model: ModelRef,
	) {}

	get done(): boolean {
		return this.#done;
	}

	/** Starts a model step (one assistant message), ending the previous one. */
	step(): Step {
		this.#step?.end();
		this.#step = new Step(this.host, this.sessionID, this.agent, this.model);
		return this.#step;
	}

	/** kilo2 will retry the current step after an error. */
	retry(attempt: number, error: SessionStructuredError): void {
		const step = this.#step ?? this.step();
		this.host.publish(this.sessionID, "session.retry.scheduled", {
			assistantMessageID: step.message.id,
			attempt,
			at: Date.now() + 1_000,
			error,
		});
	}

	succeed(): void {
		this.#finish("succeeded", "session.execution.succeeded", {});
	}

	fail(error: SessionStructuredError): void {
		this.#finish("failed", "session.execution.failed", { error }, error);
	}

	interrupt(reason: "user" | "shutdown" | "superseded" | "inactivity" = "user"): void {
		this.#finish("interrupted", "session.execution.interrupted", { reason });
	}

	#finish(
		outcome: "succeeded" | "failed" | "interrupted",
		type: string,
		data: Record<string, unknown>,
		error?: SessionStructuredError,
	) {
		if (this.#done) return;
		this.#done = true;
		this.#step?.end();
		const idle = idleMessage(outcome, error);
		this.host.append(this.sessionID, idle);
		this.host.settle(this.sessionID, outcome);
		this.host.publish(this.sessionID, type, data);
	}
}

/** One scripted step: its content in order, as `Step` would stream it. */
export type ScriptedPart =
	| { readonly type: "text"; readonly text: string; readonly native?: Native }
	| { readonly type: "reasoning"; readonly text: string; readonly native?: Native }
	| {
			readonly type: "tool";
			readonly name: string;
			readonly input: Record<string, unknown>;
			readonly output: string;
			readonly id?: string;
	  };

/** Plays scripted steps on a turn and succeeds it. */
export function playSteps(turn: Turn, steps: readonly (readonly ScriptedPart[])[]): void {
	for (const parts of steps) {
		const step = turn.step();
		for (const part of parts) {
			if (part.type === "text") step.text(part.text, part.native ? { native: part.native } : {});
			else if (part.type === "reasoning") {
				step.reasoning(part.text, part.native ? { native: part.native } : {});
			} else step.tool(part.name, part.input, part.output, part.id);
		}
		step.end();
	}
	turn.succeed();
}
