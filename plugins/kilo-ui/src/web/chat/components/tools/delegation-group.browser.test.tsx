import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { ToolCallMessagePartProps } from "@assistant-ui/react";

import type { SubagentActivity } from "../../subagents/SubagentActivityContext.js";

const runtime = vi.hoisted(() => ({
	message: { parts: [] as ToolCallMessagePartProps[], metadata: undefined as unknown },
	threadListItem: { id: "thread-1", remoteId: "session-1" },
	activities: new Map<string, SubagentActivity>(),
	stopSubagent: vi.fn(),
}));

vi.mock("@assistant-ui/react", () => ({
	useAuiState: (selector: (state: typeof runtime) => unknown) => selector(runtime),
}));

vi.mock("../../runtime/use-optional-opencode-runtime-extras.js", () => ({
	useOptionalOpenCodeRuntimeExtras: () => ({ session: { id: "session-1" } }),
}));

vi.mock("../../subagents/SubagentActivityContext.js", () => ({
	useSubagentActivity: () => ({
		activityByToolCallId: runtime.activities,
		stoppingIds: new Set(),
		stopSubagent: runtime.stopSubagent,
	}),
}));

import { useRightPanelStore } from "../../right-panel/right-panel-store.js";
import { useDelegationRevealStore } from "../../subagents/delegation-reveal-store.js";
import { ManualDisclosureProvider } from "./activity-group.js";
import { DelegationGroup } from "./delegation-group.js";
import { TaskActivity } from "./tool-ui-task.js";

const taskPart = (id: string, description: string): ToolCallMessagePartProps => ({
	type: "tool-call",
	toolCallId: id,
	toolName: "task",
	args: { description, subagent_type: "explore" },
	argsText: "{}",
	status: { type: "complete" },
	addResult: vi.fn(),
	resume: vi.fn(),
	respondToApproval: vi.fn(),
});

const trackChild = (toolCallId: string, status: SubagentActivity["status"]) => {
	runtime.activities.set(toolCallId, {
		childSessionId: `child-${toolCallId}`,
		toolCallId,
		title: runtime.message.parts.find((part) => part.toolCallId === toolCallId)?.args
			.description as string,
		typeLabel: "Explore",
		status,
	});
};

const renderGroup = (parts: ToolCallMessagePartProps[]) => {
	runtime.message.parts = parts;
	return render(
		<ManualDisclosureProvider>
			<DelegationGroup group={{ indices: parts.map((_, index) => index) }}>
				{parts.map((part) => (
					<TaskActivity key={part.toolCallId} {...part} />
				))}
			</DelegationGroup>
		</ManualDisclosureProvider>,
	);
};

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	useDelegationRevealStore.setState({ request: null });
	runtime.activities.clear();
	runtime.stopSubagent.mockReset();
});

describe("DelegationGroup", () => {
	it("opens while a subagent runs and offers its row", async () => {
		runtime.message.parts = [taskPart("call-1", "Map the auth flow")];
		trackChild("call-1", "working");
		const { baseElement } = renderGroup(runtime.message.parts);
		const screen = page.elementLocator(baseElement);

		const toggle = screen.getByTestId("kilo-delegation-group-toggle");
		await expect.element(toggle.getByText("Map the auth flow")).toBeVisible();
		expect(toggle.element().textContent).toContain("Delegating");
		await screen.getByRole("button", { name: "Stop subagent: Map the auth flow" }).click();
		expect(runtime.stopSubagent).toHaveBeenCalledWith(
			expect.objectContaining({ childSessionId: "child-call-1" }),
		);
	});

	it("stays collapsed once every subagent is done until the user expands it", async () => {
		runtime.message.parts = [
			taskPart("call-1", "Map the auth flow"),
			taskPart("call-2", "Audit IPC"),
		];
		trackChild("call-1", "done");
		trackChild("call-2", "done");
		const { baseElement } = renderGroup(runtime.message.parts);
		const screen = page.elementLocator(baseElement);
		const toggle = screen.getByTestId("kilo-delegation-group-toggle");

		await expect.element(toggle).toHaveTextContent("Delegated 2 subagents");
		await expect.element(screen.getByText("Audit IPC")).not.toBeInTheDocument();

		await toggle.click();
		await screen.getByRole("button", { name: "Open subagent: Audit IPC" }).click();
		expect(useRightPanelStore.getState().bySessionId["session-1"]?.tabs).toHaveLength(1);
	});

	it("folds settled rows past the cap while keeping running ones visible", async () => {
		const parts = Array.from({ length: 8 }, (_, index) =>
			taskPart(`call-${index}`, `Task ${index}`),
		);
		runtime.message.parts = parts;
		for (const part of parts) trackChild(part.toolCallId, "done");
		trackChild("call-7", "working");
		const { baseElement } = renderGroup(parts);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Task 7")).toBeVisible();
		await expect.element(screen.getByText("Task 5")).not.toBeInTheDocument();

		await screen.getByTestId("kilo-delegation-group-more").click();
		await expect.element(screen.getByText("Task 5")).toBeVisible();
	});

	it("opens and scrolls to a delegation the composer asks to reveal", async () => {
		const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
		const parts = Array.from({ length: 8 }, (_, index) =>
			taskPart(`call-${index}`, `Task ${index}`),
		);
		runtime.message.parts = parts;
		for (const part of parts) trackChild(part.toolCallId, "done");
		const { baseElement } = renderGroup(parts);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByText("Task 6")).not.toBeInTheDocument();

		useDelegationRevealStore.getState().reveal("call-6");

		await expect.element(screen.getByText("Task 6")).toBeVisible();
		await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
		await vi.waitFor(() => expect(useDelegationRevealStore.getState().request).toBeNull());
		await expect
			.element(screen.getByTestId("kilo-delegation-group-toggle"))
			.toHaveAttribute("aria-expanded", "true");
	});
});
