import {
	AssistantRuntimeProvider,
	ThreadPrimitive,
	useAuiState,
	useExternalStoreRuntime,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import { cleanup, render } from "@testing-library/react";
import type { FC } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { WindowedMessages } from "./message-window";

interface Snapshot {
	readonly messages: readonly ThreadMessageLike[];
	readonly isRunning: boolean;
}

const user = (id: string): ThreadMessageLike => ({
	id,
	role: "user",
	content: [{ type: "text", text: id }],
});
const assistant = (id: string): ThreadMessageLike => ({
	id,
	role: "assistant",
	content: [{ type: "text", text: id }],
});

const Message: FC = () => {
	const role = useAuiState((s) => s.message.role);
	// Any animation stands in for the entrance one; the test stylesheet has no tw-animate-css.
	return <div data-testid={`message-${role}`} className="animate-spin" />;
};

afterEach(cleanup);

const Transcript: FC<{ snapshot: Snapshot }> = ({ snapshot }) => {
	const runtime = useExternalStoreRuntime({
		messages: snapshot.messages,
		isRunning: snapshot.isRunning,
		convertMessage: (message: ThreadMessageLike) => message,
		onNew: async () => undefined,
	});
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ThreadPrimitive.Root>
				<ThreadPrimitive.Viewport>
					<WindowedMessages Message={Message} />
				</ThreadPrimitive.Viewport>
			</ThreadPrimitive.Root>
		</AssistantRuntimeProvider>
	);
};

const lastAssistant = () => {
	const all = document.querySelectorAll<HTMLElement>('[data-testid="message-assistant"]');
	return all[all.length - 1]!;
};
const animates = (element: HTMLElement) => getComputedStyle(element).animationName !== "none";

/** Renders the transcript at `initial`; the returned function moves it to a new snapshot. */
function renderTranscript(initial: Snapshot): (snapshot: Snapshot) => void {
	const { rerender } = render(<Transcript snapshot={initial} />);
	return (snapshot) => rerender(<Transcript snapshot={snapshot} />);
}

describe("message entrance animation", () => {
	it("plays once for a turn whose placeholder messages are swapped for the server's", () => {
		const setSnapshot = renderTranscript({
			messages: [user("msg_0"), assistant("msg_0a")],
			isRunning: false,
		});

		// Sent: the pending user message, and assistant-ui's optimistic reply.
		setSnapshot({
			messages: [user("msg_0"), assistant("msg_0a"), user("local:abc")],
			isRunning: true,
		});
		expect(animates(lastAssistant())).toBe(true);

		// The server echoes the user message under its own id; the optimistic reply's id changes.
		setSnapshot({
			messages: [user("msg_0"), assistant("msg_0a"), user("msg_1")],
			isRunning: true,
		});
		expect(animates(lastAssistant())).toBe(false);

		// The server's reply replaces the optimistic one.
		setSnapshot({
			messages: [user("msg_0"), assistant("msg_0a"), user("msg_1"), assistant("msg_1a")],
			isRunning: true,
		});
		expect(animates(lastAssistant())).toBe(false);

		// The next turn extends the transcript, so it enters again.
		setSnapshot({
			messages: [
				user("msg_0"),
				assistant("msg_0a"),
				user("msg_1"),
				assistant("msg_1a"),
				user("msg_2"),
				assistant("msg_2a"),
			],
			isRunning: false,
		});
		expect(animates(lastAssistant())).toBe(true);
	});

	it("plays for messages that follow a revert, which shortened the transcript", () => {
		const setSnapshot = renderTranscript({
			messages: [user("msg_0"), assistant("msg_0a"), user("msg_1"), assistant("msg_1a")],
			isRunning: false,
		});

		setSnapshot({ messages: [user("msg_0"), assistant("msg_0a")], isRunning: false });
		setSnapshot({
			messages: [user("msg_0"), assistant("msg_0a"), user("msg_3"), assistant("msg_3a")],
			isRunning: false,
		});

		expect(animates(lastAssistant())).toBe(true);
	});
});
