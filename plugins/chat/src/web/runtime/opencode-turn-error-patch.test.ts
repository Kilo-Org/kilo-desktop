import {
	createOpenCodeThreadState,
	reduceOpenCodeThreadState,
	type OpenCodeThreadState,
} from "@assistant-ui/react-opencode";
import { describe, expect, it } from "vitest";

/*
 * Turn errors in the pnpm patch (plugins/chat/patches/
 * @assistant-ui__react-opencode@0.2.17.patch): a `session.error` (or a
 * refused prompt) ends the turn the client started, even when Kilo never
 * sends the idle that would, and is kept as `turnError` for the transcript.
 */

const noModel = {
	name: "UnknownError",
	data: { message: "ProviderNoProvidersError: No providers are available" },
};

const started = () =>
	reduceOpenCodeThreadState(createOpenCodeThreadState("ses_1"), { type: "run.started" });

const isRunning = (state: OpenCodeThreadState) =>
	state.runState.type === "streaming" || state.sessionStatus?.type === "busy";

describe("a turn that fails", () => {
	it("stops running and keeps the error when Kilo reports it without an idle", () => {
		const state = reduceOpenCodeThreadState(started(), { type: "turn.failed", error: noModel });

		expect(isRunning(state)).toBe(false);
		expect(state.turnError).toEqual({ error: noModel });
	});

	it("keeps the error through the idle that follows it", () => {
		const failed = reduceOpenCodeThreadState(started(), { type: "turn.failed", error: noModel });

		const idle = reduceOpenCodeThreadState(failed, { type: "session.idle", sessionId: "ses_1" });
		const status = reduceOpenCodeThreadState(failed, {
			type: "session.status",
			status: { type: "idle" },
		});

		expect(idle.turnError).toEqual({ error: noModel });
		expect(status.turnError).toEqual({ error: noModel });
	});

	it("stops running when the prompt itself is refused", () => {
		const pending = {
			clientId: "c1",
			createdAt: 1,
			parts: [],
			contentText: "Hi",
			status: "pending",
		} as never;
		const queued = reduceOpenCodeThreadState(started(), { type: "local.message.queued", pending });
		const error = new Error("The model is overloaded");

		const state = reduceOpenCodeThreadState(queued, {
			type: "local.message.failed",
			clientId: "c1",
			error,
		});

		expect(isRunning(state)).toBe(false);
		expect(state.turnError).toEqual({ error });
	});

	it.each([
		["this client sends the next prompt", { type: "run.started" }],
		["the server starts a turn", { type: "session.status", status: { type: "busy" } }],
		[
			"the server retries a turn",
			{ type: "session.status", status: { type: "retry", attempt: 1, message: "", next: 1 } },
		],
	] as const)("forgets the error when %s", (_when, event) => {
		const failed = reduceOpenCodeThreadState(started(), { type: "turn.failed", error: noModel });

		const next = reduceOpenCodeThreadState(failed, event as never);

		expect(next.turnError).toBeUndefined();
		expect(isRunning(next)).toBe(true);
	});

	it("leaves other failures (a stop or history read that failed) to the server's status", () => {
		const state = reduceOpenCodeThreadState(started(), {
			type: "run.failed",
			error: new Error("abort failed"),
		});

		expect(state.sessionStatus).toEqual({ type: "busy" });
		expect(state.turnError).toBeUndefined();
	});
});
