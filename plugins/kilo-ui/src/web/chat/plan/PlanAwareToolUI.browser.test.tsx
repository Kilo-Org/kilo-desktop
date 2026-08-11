import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type * as AssistantUiReact from "@assistant-ui/react";

import { PlanAwareToolUI } from "./PlanAwareToolUI.js";
import type { PlanThreadProjection } from "./plan-projection.js";

const projectionState = vi.hoisted(() => ({
	current: undefined as PlanThreadProjection | undefined,
}));

vi.mock("@assistant-ui/react", async (importOriginal) => {
	const actual = await importOriginal<typeof AssistantUiReact>();
	return {
		...actual,
		useAuiState: (selector: (state: { message: { id: string } }) => unknown) =>
			selector({ message: { id: "msg-exit" } }),
	};
});

vi.mock("./use-plan-thread-projection.js", () => ({
	usePlanThreadProjection: () => projectionState.current,
}));

vi.mock("./PlanCard.js", () => ({
	PlanCard: () => <div data-qa-id="kilo-plan-card">Plan card</div>,
}));

afterEach(() => {
	cleanup();
	projectionState.current = undefined;
});

describe("PlanAwareToolUI", () => {
	it("renders the plan card instead of the projected write row", async () => {
		projectionState.current = {
			byMessageId: new Map([
				[
					"msg-exit",
					{
						status: "ready",
						path: "1786492270654-random-snack-inventory.md",
						markdown: "# Random Plan: Desk Snack Inventory",
						anchorCallId: "write-plan",
						hiddenCallIds: new Set(["write-plan", "exit-plan"]),
					},
				],
			]),
			byAnchorCallId: new Map(),
			newest: undefined,
		};
		const BaseWrite = () => <div data-qa-id="write-row">Wrote random plan.md</div>;
		const PlanAwareWrite = PlanAwareToolUI(BaseWrite);

		const { baseElement } = render(
			<PlanAwareWrite
				type="tool-call"
				toolName="write"
				toolCallId="write-plan"
				args={{ filePath: "1786492270654-random-snack-inventory.md" }}
				argsText=""
				status={{ type: "complete" }}
				addResult={vi.fn()}
				resume={vi.fn()}
				respondToApproval={vi.fn()}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-plan-card")).toBeVisible();
		await expect.element(screen.getByTestId("write-row")).not.toBeInTheDocument();
	});
});
