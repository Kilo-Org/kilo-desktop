import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenCodeThreadState } from "@assistant-ui/react-opencode";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import { ChatConnectionProvider } from "../connection/ChatConnectionContext.js";
import { SessionActivityProvider } from "../../session/activity/SessionActivityProvider.js";
import { createSessionActivityStore } from "../../session/activity/session-activity-store.js";

const runtime = vi.hoisted(() => ({ extras: undefined as unknown }));

vi.mock("../runtime/use-optional-opencode-runtime-extras.js", () => ({
	useOptionalOpenCodeRuntimeExtras: () => runtime.extras,
}));

import { SubagentActivityProvider, useSubagentActivity } from "./SubagentActivityContext.js";

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "7.7.5",
	globalDirectory: "/tmp",
};

const extrasFor = (sessionId: string, activeChild: boolean) => {
	const parent = {
		...createOpenCodeThreadState(sessionId),
		loadState: { type: "ready" as const },
		messageOrder: activeChild ? ["message-1"] : [],
		messagesById: activeChild
			? {
					"message-1": {
						parts: [
							{
								type: "tool",
								tool: "task",
								callID: "call-1",
								state: {
									input: { description: "Explore auth" },
									metadata: { sessionId: "child-1" },
								},
							},
						],
					},
				}
			: {},
		childSessionsById: activeChild
			? {
					"child-1": {
						...createOpenCodeThreadState("child-1"),
						sessionStatus: { type: "busy" as const },
					},
				}
			: {},
	};
	return { session: { id: sessionId, directory: "/tmp" }, state: parent };
};

afterEach(() => {
	cleanup();
	runtime.extras = undefined;
});

const taskPart = (callID: string, sessionId: string, description: string) => ({
	type: "tool",
	tool: "task",
	callID,
	state: { input: { description }, metadata: { sessionId } },
});

describe("SubagentActivityProvider", () => {
	it("lists delegations from every turn and indexes the ones still running", () => {
		const child = (id: string, status: "idle" | "busy" = "idle") => ({
			...createOpenCodeThreadState(id),
			sessionStatus: { type: status },
		});
		runtime.extras = {
			session: { id: "parent", directory: "/tmp" },
			state: {
				...createOpenCodeThreadState("parent"),
				messageOrder: ["user-1", "assistant-1", "user-2", "assistant-2"],
				messagesById: {
					"user-1": { info: { role: "user" }, parts: [] },
					"assistant-1": {
						info: { role: "assistant" },
						parts: [taskPart("call-old", "child-old", "Earlier turn")],
					},
					"user-2": { info: { role: "user" }, parts: [] },
					"assistant-2": {
						info: { role: "assistant" },
						parts: [
							taskPart("call-b", "child-b", "Second"),
							taskPart("call-a", "child-a", "First"),
						],
					},
				},
				childSessionsById: {
					"child-a": child("child-a"),
					"child-old": child("child-old"),
					"child-b": child("child-b", "busy"),
				},
			},
		};
		let value: ReturnType<typeof useSubagentActivity> | undefined;
		const Probe = () => {
			value = useSubagentActivity();
			return null;
		};

		render(
			<SessionActivityProvider store={createSessionActivityStore({ storage: null })}>
				<ChatConnectionProvider
					status={{
						isPending: false,
						isError: false,
						error: null,
						connection,
						connectionPromise: Promise.resolve(connection),
					}}
				>
					<SubagentActivityProvider>
						<Probe />
					</SubagentActivityProvider>
				</ChatConnectionProvider>
			</SessionActivityProvider>,
		);

		expect(value?.activities.map((activity) => activity.title)).toEqual([
			"Earlier turn",
			"Second",
			"First",
		]);
		expect(value?.activeActivities.map((activity) => activity.title)).toEqual(["Second"]);
		expect(value?.hasActiveSubagents).toBe(true);
		expect(value?.activityByToolCallId.get("call-a")?.status).toBe("done");
	});

	it("releases synthesized parent activity when the selected session changes", () => {
		const store = createSessionActivityStore({ storage: null });
		const wrapper = (children: React.ReactNode) => (
			<SessionActivityProvider store={store}>
				<ChatConnectionProvider
					status={{
						isPending: false,
						isError: false,
						error: null,
						connection,
						connectionPromise: Promise.resolve(connection),
					}}
				>
					<SubagentActivityProvider>{children}</SubagentActivityProvider>
				</ChatConnectionProvider>
			</SessionActivityProvider>
		);

		runtime.extras = extrasFor("parent-a", true);
		const view = render(wrapper(<div />));
		expect(store.getState().sessions["parent-a"]?.status).toBe("busy");

		runtime.extras = extrasFor("parent-b", false);
		view.rerender(wrapper(<div />));

		expect(store.getState().sessions["parent-a"]?.status).toBe("idle");
		expect(store.getState().sessions["parent-b"]?.status).not.toBe("busy");
	});
});
