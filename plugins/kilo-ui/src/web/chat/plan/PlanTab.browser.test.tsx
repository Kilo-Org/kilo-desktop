import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type * as AssistantUiReact from "@assistant-ui/react";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import { FIND_BAR_FEATURE_FLAG } from "@kilo-desktop/ui/components/find-bar";

import type * as UseApprovePlan from "./use-approve-plan.js";
import { PlanTab } from "./PlanTab.js";
const plan = vi.hoisted(() => ({
	status: "ready" as const,
	path: ".kilo/plans/search.md",
	markdown: "# Ship search\n\nWire find into the panes, then ship search.",
	anchorCallId: "call-plan",
	hiddenCallIds: new Set<string>(),
}));

vi.mock("@assistant-ui/react", async (importOriginal) => ({
	...(await importOriginal<typeof AssistantUiReact>()),
	useAuiState: (
		selector: (state: { threadListItem: { remoteId: string; id: string } }) => unknown,
	) => selector({ threadListItem: { remoteId: "session-plan", id: "session-plan" } }),
}));

vi.mock("./use-plan-thread-projection.js", () => ({
	usePlanThreadProjection: () => ({
		byMessageId: new Map(),
		byAnchorCallId: new Map(),
		newest: plan,
	}),
}));

vi.mock("./use-plan-content.js", () => ({
	usePlanContent: () => ({ markdown: plan.markdown, isLoading: false, isError: false }),
}));

vi.mock("./use-approve-plan.js", async (importOriginal) => ({
	...(await importOriginal<typeof UseApprovePlan>()),
	useApprovePlan: () => ({ approve: vi.fn(), submitting: false, approved: false }),
}));

afterEach(cleanup);

async function renderPlanTab(flags: Record<string, unknown>) {
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		featureFlags: {
			peek: () => flags,
			subscribe: (listener) => {
				listener(flags);
				return () => undefined;
			},
		},
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const result = render(
		<SdkProvider system={system}>
			<PlanTab sessionId="session-plan" />
		</SdkProvider>,
	);
	await expect
		.element(page.elementLocator(result.baseElement).getByTestId("chat-pane-plan-body"))
		.toBeVisible();
	return result;
}

function pressFindChord(): KeyboardEvent {
	const modifier = navigator.platform.startsWith("Mac") ? "metaKey" : "ctrlKey";
	const event = new KeyboardEvent("keydown", {
		key: "f",
		[modifier]: true,
		bubbles: true,
		cancelable: true,
	});
	window.dispatchEvent(event);
	return event;
}

describe("PlanTab find", () => {
	it("searches the plan body, not the title in the pane header", async () => {
		const { baseElement } = await renderPlanTab({ [FIND_BAR_FEATURE_FLAG]: true });
		expect(baseElement.querySelector('[data-qa-id="chat-pane-plan"]')?.textContent).toContain(
			"Ship search",
		);

		pressFindChord();
		await page.elementLocator(baseElement).getByTestId("plan-find-input").fill("ship search");

		await vi.waitFor(() =>
			expect(baseElement.querySelector('[data-qa-id="plan-find-count"]')?.textContent).toBe("1/1"),
		);
	});

	it("leaves the chord alone while the searchbar flag is off", async () => {
		const { baseElement } = await renderPlanTab({});

		const event = pressFindChord();

		expect(event.defaultPrevented).toBe(false);
		expect(baseElement.querySelector("[data-find-scope]")).toBeNull();
	});
});
