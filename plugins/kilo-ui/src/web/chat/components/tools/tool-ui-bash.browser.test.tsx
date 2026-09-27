import { cleanup, fireEvent, render } from "@testing-library/react";
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
		metadata: undefined as { custom?: { opencode?: { parts?: unknown } } } | undefined,
	},
}));

vi.mock("@assistant-ui/react", () => ({
	useAuiState: (selector: (state: { message: typeof runtime.message }) => unknown) =>
		selector({ message: runtime.message }),
	useScrollLock: () => () => undefined,
}));

vi.mock("@assistant-ui/react-opencode", () => ({
	useOpenCodeQuestions: () => [],
	useOpenCodePermissions: () => ({ pending: [], reply: vi.fn() }),
}));

vi.mock("../../runtime/use-optional-opencode-runtime-extras.js", () => ({
	useOptionalOpenCodeRuntimeExtras: () => undefined,
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
	runtime.message.metadata = undefined;
	cleanup();
});

describe("BashTerminal activity subgroup", () => {
	it("lets a solo running command expand to show the full command", () => {
		const part = bashPart({ type: "running" });
		runtime.message.parts = [part];
		runtime.message.status = { type: "running" };

		const { baseElement, getByRole, getByText } = render(
			<ActivityGroup group={{ indices: [0] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="terminal">
					<BashTerminal {...part} />
				</ActivitySubgroup>
			</ActivityGroup>,
		);

		expect(baseElement.textContent).toContain("Running pnpm test");
		expect(baseElement.textContent?.match(/pnpm test/g)).toHaveLength(1);

		fireEvent.click(getByRole("button", { name: "Running pnpm test" }));

		expect(getByText("$ pnpm test")).toBeDefined();
	});

	it("streams live command output while the tool is running", () => {
		const part = bashPart({ type: "running" });
		runtime.message.parts = [part];
		runtime.message.status = { type: "running" };
		runtime.message.metadata = {
			custom: {
				opencode: {
					parts: [
						{
							type: "tool",
							callID: "call-1",
							state: {
								metadata: {
									output: `${String.fromCharCode(0x1b)}[32mpassing${String.fromCharCode(0x1b)}[0m\r\n`,
								},
							},
						},
					],
				},
			},
		};

		const { getByRole, getByText } = render(
			<ActivityGroup group={{ indices: [0] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="terminal">
					<BashTerminal {...part} />
				</ActivitySubgroup>
			</ActivityGroup>,
		);

		fireEvent.click(getByRole("button", { name: "Running pnpm test" }));

		expect(getByText("$ pnpm test")).toBeDefined();
		expect(getByText(/passing/)).toBeDefined();
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
		expect(baseElement.textContent).toContain("Ran pnpm test");
	});

	it("uses check icons for completed commands", () => {
		const first = bashPart({ type: "complete" });
		const second = {
			...bashPart({ type: "complete" }),
			toolCallId: "call-2",
			args: { command: "pnpm lint" },
		};
		runtime.message.parts = [first, second];
		runtime.message.status = { type: "complete" };

		const { baseElement, getByRole } = render(
			<ActivityGroup group={{ indices: [0, 1] }}>
				<ActivitySubgroup group={{ indices: [0, 1] }} kind="terminal">
					<BashTerminal {...first} />
					<BashTerminal {...second} />
				</ActivitySubgroup>
			</ActivityGroup>,
		);

		fireEvent.click(getByRole("button", { name: "Ran 2 commands" }));
		expect(baseElement.querySelectorAll(".lucide-check")).toHaveLength(2);
		expect(baseElement.querySelector(".lucide-dollar-sign")).toBeNull();
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
