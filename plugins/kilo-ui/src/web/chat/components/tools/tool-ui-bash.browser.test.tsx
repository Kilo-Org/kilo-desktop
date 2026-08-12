import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolCallMessagePartProps } from "@assistant-ui/react";

const runtime = vi.hoisted(() => ({
	message: {
		parts: [] as Array<{
			type: string;
			toolName?: string;
			args?: Record<string, unknown>;
			status: { type: string };
		}>,
		status: { type: "running" },
	},
}));

vi.mock("@assistant-ui/react", () => ({
	useAuiState: (selector: (state: { message: typeof runtime.message }) => unknown) =>
		selector({ message: runtime.message }),
	useScrollLock: () => () => undefined,
}));

vi.mock("@assistant-ui/react-opencode", () => ({
	useOpenCodeQuestions: () => [],
}));

import { ActivityGroup, ActivitySubgroup } from "./activity-group.js";
import { BashTerminal } from "./tool-ui-bash.js";

const bashPart = (status: ToolCallMessagePartProps["status"]): ToolCallMessagePartProps => ({
	type: "tool-call",
	toolCallId: "call-1",
	toolName: "bash",
	args: { command: "pnpm test" },
	argsText: '{"command":"pnpm test"}',
	status,
	addResult: vi.fn(),
	resume: vi.fn(),
	respondToApproval: vi.fn(),
});

afterEach(() => {
	cleanup();
});

describe("BashTerminal activity subgroup", () => {
	it("shows a solo running command once in the subgroup header", () => {
		const part = bashPart({ type: "running" });
		runtime.message.parts = [part];
		runtime.message.status = { type: "running" };

		const { baseElement } = render(
			<ActivityGroup group={{ indices: [0] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="terminal">
					<BashTerminal {...part} />
				</ActivitySubgroup>
			</ActivityGroup>,
		);

		expect(baseElement.textContent).toContain("Running pnpm test");
		expect(baseElement.textContent?.match(/pnpm test/g)).toHaveLength(1);
	});
});

describe("ActivityGroup single-subgroup unwrap", () => {
	it("skips the outer tools-used row when the group is one completed tool", () => {
		const part = bashPart({ type: "complete" });
		runtime.message.parts = [part];
		runtime.message.status = { type: "complete" };

		const { baseElement } = render(
			<ActivityGroup group={{ indices: [0] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="terminal">
					<BashTerminal {...part} />
				</ActivitySubgroup>
			</ActivityGroup>,
		);

		expect(baseElement.textContent).not.toMatch(/tool used/);
		expect(baseElement.textContent).not.toContain("Show less");
		expect(baseElement.textContent).toContain("Ran pnpm test");
	});

	it("keeps the outer tools-used row when thinking and a tool share the group", () => {
		const part = bashPart({ type: "complete" });
		runtime.message.parts = [{ type: "reasoning", status: { type: "complete" } }, part];
		runtime.message.status = { type: "complete" };

		const { baseElement } = render(
			<ActivityGroup group={{ indices: [0, 1] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="thinking">
					thought
				</ActivitySubgroup>
				<ActivitySubgroup group={{ indices: [1] }} kind="terminal">
					<BashTerminal {...part} />
				</ActivitySubgroup>
			</ActivityGroup>,
		);

		expect(baseElement.textContent).toContain("1 tool used");
		expect(baseElement.textContent).not.toContain("Ran pnpm test");
	});
});
