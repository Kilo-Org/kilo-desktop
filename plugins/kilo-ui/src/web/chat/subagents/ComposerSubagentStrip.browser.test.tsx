import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { SubagentActivity } from "./SubagentActivityContext.js";

const state = vi.hoisted(() => ({ activeActivities: [] as SubagentActivity[] }));

vi.mock("./SubagentActivityContext.js", () => ({
	useSubagentActivity: () => ({ activeActivities: state.activeActivities }),
}));

import { ComposerSubagentStrip } from "./ComposerSubagentStrip.js";
import { useDelegationRevealStore } from "./delegation-reveal-store.js";

const activity = (overrides: Partial<SubagentActivity>): SubagentActivity => ({
	childSessionId: "child-1",
	toolCallId: "call-1",
	title: "Explore auth",
	typeLabel: "Explore",
	status: "working",
	...overrides,
});

beforeEach(() => {
	state.activeActivities = [
		activity({}),
		activity({
			childSessionId: "child-2",
			toolCallId: "call-2",
			title: "Review patch",
			status: "waiting",
		}),
	];
});

afterEach(() => {
	cleanup();
	useDelegationRevealStore.setState({ request: null });
});

describe("ComposerSubagentStrip", () => {
	it("renders nothing while no subagent is running", () => {
		state.activeActivities = [];
		const { baseElement } = render(<ComposerSubagentStrip />);

		expect(baseElement.querySelector('[data-qa-id="kilo-composer-subagents"]')).toBeNull();
	});

	it("counts running and waiting subagents together", async () => {
		const { baseElement } = render(<ComposerSubagentStrip />);

		await expect.element(page.elementLocator(baseElement).getByText("2 Running")).toBeVisible();
	});

	it("asks the transcript to reveal the first running delegation", async () => {
		const { baseElement } = render(<ComposerSubagentStrip />);

		await page.elementLocator(baseElement).getByTestId("kilo-composer-subagents-jump").click();

		expect(useDelegationRevealStore.getState().request?.toolCallId).toBe("call-1");
	});
});
