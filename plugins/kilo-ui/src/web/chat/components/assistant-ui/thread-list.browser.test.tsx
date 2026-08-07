import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	AssistantRuntimeProvider,
	InMemoryThreadListAdapter,
	useLocalRuntime,
	useRemoteThreadListRuntime,
	type ChatModelAdapter,
} from "@assistant-ui/react";

import { ThreadList } from "./thread-list.js";

const noopModel: ChatModelAdapter = {
	async *run() {
		yield { content: [{ type: "text", text: "ok" }] };
	},
};

function TestThreadListHarness() {
	const runtime = useRemoteThreadListRuntime({
		adapter: new InMemoryThreadListAdapter(),
		runtimeHook: () => useLocalRuntime(noopModel),
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ThreadList />
		</AssistantRuntimeProvider>
	);
}

afterEach(() => {
	cleanup();
});

describe("ThreadList", () => {
	it("renders under a remote thread-list runtime and activates new chat", async () => {
		const { baseElement } = render(<TestThreadListHarness />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-thread-list")).toBeVisible();
		const newButton = screen.getByRole("button", { name: /new chat/i });
		await expect.element(newButton).toBeVisible();

		await userEvent.click(newButton);
		await expect.element(newButton).toHaveAttribute("aria-current", "true");
	});
});
