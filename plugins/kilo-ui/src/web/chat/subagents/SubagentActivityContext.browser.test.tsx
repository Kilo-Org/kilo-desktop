import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenCodeThreadState } from "@assistant-ui/react-opencode";

import type { KiloGlobalConnection } from "../../../contracts/chat/schemas.js";
import { ChatConnectionProvider } from "../connection/ChatConnectionContext.js";
import { SessionActivityProvider } from "../session-activity/SessionActivityProvider.js";
import { createSessionActivityStore } from "../session-activity/session-activity-store.js";

const runtime = vi.hoisted(() => ({ extras: undefined as unknown }));

vi.mock("../runtime/use-optional-opencode-runtime-extras.js", () => ({
	useOptionalOpenCodeRuntimeExtras: () => runtime.extras,
}));

import { SubagentActivityProvider } from "./SubagentActivityContext.js";

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

describe("SubagentActivityProvider", () => {
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
