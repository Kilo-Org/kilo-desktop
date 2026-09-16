import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import type { ToolCallMessagePartComponent, ToolCallMessagePartProps } from "@assistant-ui/react";

const runtime = vi.hoisted(() => ({
	message: {
		parts: [] as ToolCallMessagePartProps[],
		status: { type: "complete" },
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
import { ApplyPatchDiff } from "./tool-ui-apply-patch.js";
import { BashTerminal } from "./tool-ui-bash.js";
import { ToolCallFallback } from "./tool-ui-inline.js";
import { ReadActivity } from "./tool-ui-read-search.js";
import { SkillActivity } from "./tool-ui-skill.js";
import { TaskActivity } from "./tool-ui-task.js";
import { WebFetchActivity, WebSearchActivity } from "./tool-ui-web.js";
import type { ActivityKind } from "./tool-categories.js";

const toolPart = (
	id: string,
	toolName: string,
	args: ToolCallMessagePartProps["args"],
): ToolCallMessagePartProps => ({
	type: "tool-call",
	toolCallId: id,
	toolName,
	args,
	argsText: JSON.stringify(args),
	status: { type: "complete" },
	addResult: vi.fn(),
	resume: vi.fn(),
	respondToApproval: vi.fn(),
});

const readPart = (id: string, path: string) => toolPart(id, "read", { file_path: path });
const skillPart = (id: string, name: string) => toolPart(id, "skill", { name });
const planningPart = (id: string, toolName: "todowrite" | "todoread") => toolPart(id, toolName, {});
const taskPart = (
	id: string,
	args: { description?: string; prompt?: string; subagent_type?: string },
	result?: unknown,
): ToolCallMessagePartProps => ({
	...toolPart(id, "task", args),
	result,
});

const renderActivity = (
	kind: ActivityKind,
	parts: ToolCallMessagePartProps[],
	Component: ToolCallMessagePartComponent,
) => {
	runtime.message.parts = parts;
	const indices = parts.map((_, index) => index);
	const system = createFakeFeatureSystem({
		sdks: { "kilo-ui": createFakeSdk({ featureId: "kilo-ui" }) },
	});

	return render(
		<SdkProvider system={system}>
			<ActivityGroup group={{ indices }}>
				<ActivitySubgroup group={{ indices }} kind={kind}>
					{parts.map((part) => (
						<Component key={part.toolCallId} {...part} />
					))}
				</ActivitySubgroup>
			</ActivityGroup>
		</SdkProvider>,
	);
};

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("Reading activity subgroup", () => {
	it("renders one read as a single non-collapsible line", () => {
		const { baseElement, queryByRole } = renderActivity(
			"reading",
			[readPart("call-1", "/src/mark.svg")],
			ReadActivity,
		);

		expect(baseElement.textContent?.trim()).toBe("Read mark.svg");
		expect(queryByRole("button")).toBeNull();
	});

	it("collapses a multi-file read list and lets the user toggle it", async () => {
		const { baseElement, getByRole, getByText, queryByText } = renderActivity(
			"reading",
			[readPart("call-1", "/src/mark.svg"), readPart("call-2", "/src/logo.svg")],
			ReadActivity,
		);
		const trigger = getByRole("button", { name: "Read 2 files" });

		expect(baseElement.textContent?.trim()).toBe("Read 2 files");
		expect(queryByText("mark.svg")).toBeNull();
		expect(queryByText("logo.svg")).toBeNull();

		fireEvent.click(trigger);
		expect(getByText("mark.svg")).toBeDefined();
		expect(getByText("logo.svg")).toBeDefined();

		fireEvent.click(trigger);
		await waitFor(() => {
			expect(baseElement.textContent?.trim()).toBe("Read 2 files");
			expect(queryByText("mark.svg")).toBeNull();
			expect(queryByText("logo.svg")).toBeNull();
		});
	});

	it("keeps a single running read collapsed when reasoning shares the activity group", () => {
		const thought = {
			type: "reasoning",
			text: "I will inspect the workspace.",
			status: { type: "complete" as const },
		} as unknown as ToolCallMessagePartProps;
		const read = {
			...readPart("call-1", "/src/mark.svg"),
			status: { type: "running" as const },
		};
		runtime.message.parts = [thought, read];
		runtime.message.status = { type: "running" };

		const { getByRole } = render(
			<ActivityGroup group={{ indices: [0, 1] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="thinking">
					<div>I will inspect the workspace.</div>
				</ActivitySubgroup>
				<ActivitySubgroup group={{ indices: [1] }} kind="reading">
					<ReadActivity {...read} />
				</ActivitySubgroup>
			</ActivityGroup>,
		);
		const trigger = getByRole("button", { name: "Reading mark.svg" });

		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(trigger.querySelector('[data-slot="activity-disclosure-icon"]')).toHaveClass(
			"lucide-chevron-right",
		);

		fireEvent.click(trigger);

		expect(getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
	});

	it("keeps a single running tool collapsed after earlier completed tools", () => {
		const completedRead = readPart("call-1", "/src/mark.svg");
		const runningCommand = {
			...toolPart("call-2", "bash", { command: "gh run view --job 104579955735" }),
			status: { type: "running" as const },
		};
		runtime.message.parts = [completedRead, runningCommand];
		runtime.message.status = { type: "running" };

		const { getByRole, queryByText } = render(
			<ActivityGroup group={{ indices: [0, 1] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="reading">
					<ReadActivity {...completedRead} />
				</ActivitySubgroup>
				<ActivitySubgroup group={{ indices: [1] }} kind="terminal">
					<ToolCallFallback {...runningCommand} />
				</ActivitySubgroup>
			</ActivityGroup>,
		);
		const trigger = getByRole("button", { name: /gh run view --job 104579955735/ });

		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(queryByText(/Unknown JSON field/)).toBeNull();
	});
});

describe("Skill activity subgroup", () => {
	it("renders one skill read as a single non-collapsible line", () => {
		const { baseElement, queryByRole } = renderActivity(
			"skill",
			[skillPart("call-1", "write-vitest")],
			SkillActivity,
		);

		expect(baseElement.textContent?.trim()).toBe("Read Skill write-vitest");
		expect(queryByRole("button")).toBeNull();
	});

	it("collapses multiple skill reads and lets the user toggle them", async () => {
		const { getByRole, getByText, queryByText } = renderActivity(
			"skill",
			[skillPart("call-1", "write-vitest"), skillPart("call-2", "tools")],
			SkillActivity,
		);
		const trigger = getByRole("button", { name: "Read 2 Skills" });

		expect(queryByText("write-vitest")).toBeNull();
		expect(queryByText("tools")).toBeNull();

		fireEvent.click(trigger);
		expect(getByText("write-vitest")).toBeDefined();
		expect(getByText("tools")).toBeDefined();

		fireEvent.click(trigger);
		await waitFor(() => {
			expect(queryByText("write-vitest")).toBeNull();
			expect(queryByText("tools")).toBeNull();
		});
	});
});

describe("Subagent activity subgroup", () => {
	it("renders one completed task as a collapsible header with hidden detail", () => {
		const { baseElement, getByRole, getByText, queryByText } = renderActivity(
			"subagent",
			[
				taskPart(
					"call-1",
					{
						description: "Explore auth flow",
						prompt: "Find how login works.",
						subagent_type: "explore",
					},
					"<task_result>\nLogin lives in `auth.ts`.\n</task_result>",
				),
			],
			TaskActivity,
		);
		const trigger = getByRole("button", { name: "Delegated Explore auth flow" });

		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(trigger.querySelector('[data-slot="activity-disclosure-icon"]')).toHaveClass(
			"lucide-chevron-right",
		);
		expect(queryByText("Find how login works.")).toBeNull();
		expect(queryByText("Login lives in", { exact: false })).toBeNull();

		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(trigger.querySelector('[data-slot="activity-disclosure-icon"]')).toHaveClass(
			"lucide-chevron-down",
		);
		expect(queryByText("Find how login works.")).toBeNull();
		expect(getByText("Login lives in", { exact: false })).toBeDefined();
		expect(baseElement.querySelector("code")?.textContent).toBe("auth.ts");
		expect(getByText("@explore")).toBeDefined();
	});

	it("does not reveal a single task result when the running call completes", () => {
		const runningPart = {
			...taskPart(
				"call-1",
				{ description: "Explore auth flow", subagent_type: "explore" },
				"<task_result>Partial result</task_result>",
			),
			status: { type: "running" as const },
		};
		const renderGroup = (part: ToolCallMessagePartProps) => (
			<ActivityGroup group={{ indices: [0] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="subagent">
					<TaskActivity {...part} />
				</ActivitySubgroup>
			</ActivityGroup>
		);
		runtime.message.parts = [runningPart];
		runtime.message.status = { type: "running" };
		const { queryByText, rerender } = render(renderGroup(runningPart));

		const completedPart = { ...runningPart, status: { type: "complete" as const } };
		runtime.message.parts = [completedPart];
		runtime.message.status = { type: "complete" };
		rerender(renderGroup(completedPart));

		expect(queryByText("Partial result")).toBeNull();
	});

	it("shows a solo running task once in the subgroup header", () => {
		const part = {
			...taskPart("call-1", { description: "Explore auth flow", subagent_type: "explore" }),
			status: { type: "running" as const },
		};
		const { baseElement, queryByRole } = renderActivity("subagent", [part], TaskActivity);

		expect(baseElement.textContent).toContain("Delegating Explore auth flow");
		expect(baseElement.textContent?.match(/Explore auth flow/g)).toHaveLength(1);
		expect(queryByRole("button")).toBeNull();
	});

	it("collapses multiple tasks and lets the user toggle them", async () => {
		const { getByRole, getByText, queryByText } = renderActivity(
			"subagent",
			[
				taskPart("call-1", { description: "Explore auth", subagent_type: "explore" }),
				taskPart("call-2", { description: "Review the patch", subagent_type: "code-reviewer" }),
			],
			TaskActivity,
		);
		const trigger = getByRole("button", { name: "Delegated 2 subagents" });

		expect(queryByText("Explore auth")).toBeNull();
		expect(queryByText("Review the patch")).toBeNull();

		fireEvent.click(trigger);
		expect(getByText("Explore auth")).toBeDefined();
		expect(getByText("Review the patch")).toBeDefined();

		fireEvent.click(trigger);
		await waitFor(() => {
			expect(queryByText("Explore auth")).toBeNull();
			expect(queryByText("Review the patch")).toBeNull();
		});
	});
});

describe("Planning activity subgroup", () => {
	it("renders one plan update as a single non-collapsible line", () => {
		const { baseElement, queryByRole } = renderActivity(
			"planning",
			[planningPart("call-1", "todowrite")],
			ToolCallFallback,
		);

		expect(baseElement.textContent?.trim()).toBe("1 plan update");
		expect(queryByRole("button")).toBeNull();
	});

	it("collapses multiple plan updates and lets the user toggle them", async () => {
		const { getByRole, getByText, queryByText } = renderActivity(
			"planning",
			[planningPart("call-1", "todowrite"), planningPart("call-2", "todoread")],
			ToolCallFallback,
		);
		const trigger = getByRole("button", { name: "2 plan updates" });

		expect(queryByText("todowrite")).toBeNull();
		expect(queryByText("todoread")).toBeNull();

		fireEvent.click(trigger);
		expect(getByText("todowrite")).toBeDefined();
		expect(getByText("todoread")).toBeDefined();

		fireEvent.click(trigger);
		await waitFor(() => {
			expect(queryByText("todowrite")).toBeNull();
			expect(queryByText("todoread")).toBeNull();
		});
	});
});

describe("Editing activity subgroup", () => {
	it("renders a multi-file patch as collapsed per-file rows", () => {
		const patchText = `*** Begin Patch
*** Update File: first.txt
@@
-before
+after
*** Update File: second.txt
@@
-old
+new
*** End Patch`;
		const { container, getByRole, queryByText } = renderActivity(
			"editing",
			[toolPart("patch-1", "apply_patch", { patchText })],
			ApplyPatchDiff,
		);
		fireEvent.click(getByRole("button", { name: "Edited 2 files" }));
		const firstRow = getByRole("button", { name: "Edited first.txt" });

		expect(getByRole("button", { name: "Edited second.txt" })).toBeDefined();
		expect(container.querySelectorAll("diffs-container")).toHaveLength(0);
		expect(queryByText("after")).toBeNull();

		fireEvent.click(firstRow);

		expect(container.querySelectorAll("diffs-container")).toHaveLength(1);
	});
});

describe("Web activity subgroup", () => {
	it("does not count hidden OpenCode lifecycle parts as web requests", () => {
		const search = toolPart("web-1", "websearch", { query: "Numba" });
		const fetch = toolPart("web-2", "webfetch", { url: "https://example.com" });
		runtime.message.parts = [
			search,
			{
				type: "data",
				name: "opencode-step-finish",
				data: {},
			} as unknown as ToolCallMessagePartProps,
			fetch,
		];

		const { getByRole, queryByRole } = render(
			<ActivityGroup group={{ indices: [0, 1, 2] }}>
				<ActivitySubgroup group={{ indices: [0, 1, 2] }} kind="web">
					<WebSearchActivity {...search} />
					<WebFetchActivity {...fetch} />
				</ActivitySubgroup>
			</ActivityGroup>,
		);

		expect(getByRole("button", { name: "2 web requests" })).toBeDefined();
		expect(queryByRole("button", { name: "3 web requests" })).toBeNull();
	});
});

describe("Activity group scrolling", () => {
	it("keeps solo active thinking expanded", () => {
		const thoughtText = "I am checking the workflow failure.";
		const runningThought = {
			type: "reasoning",
			text: thoughtText,
			status: { type: "running" as const },
		} as unknown as ToolCallMessagePartProps;
		runtime.message.parts = [runningThought];
		runtime.message.status = { type: "running" };

		const { getByRole, getByText } = render(
			<ActivityGroup group={{ indices: [0] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="thinking">
					<div>{thoughtText}</div>
				</ActivitySubgroup>
			</ActivityGroup>,
		);

		expect(getByRole("button", { name: "Thinking..." }).getAttribute("aria-expanded")).toBe("true");
		expect(getByText(thoughtText)).toBeDefined();
	});

	it("keeps active thinking expanded after an earlier tool", () => {
		const completedRead = readPart("call-1", "/src/mark.svg");
		const thoughtText = "I am checking the workflow failure.";
		const runningThought = {
			type: "reasoning",
			text: thoughtText,
			status: { type: "running" as const },
		} as unknown as ToolCallMessagePartProps;
		runtime.message.parts = [completedRead, runningThought];
		runtime.message.status = { type: "running" };

		const { getByRole, getByText } = render(
			<ActivityGroup group={{ indices: [0, 1] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="reading">
					<ReadActivity {...completedRead} />
				</ActivitySubgroup>
				<ActivitySubgroup group={{ indices: [1] }} kind="thinking">
					<div>{thoughtText}</div>
				</ActivitySubgroup>
			</ActivityGroup>,
		);

		expect(getByRole("button", { name: "Thinking..." }).getAttribute("aria-expanded")).toBe("true");
		expect(getByText(thoughtText)).toBeDefined();
	});
});

describe("Notebooks activity subgroup", () => {
	it("never moves the active subgroup back to an earlier stale-running tool", () => {
		const staleRunningRead = {
			...readPart("call-1", "/src/mark.svg"),
			status: { type: "running" as const },
		};
		const runningNotebook = {
			...toolPart("call-2", "notebooks_create_notebook", {}),
			status: { type: "running" as const },
		};
		const runningNotebookConnect = {
			...toolPart("call-3", "notebooks_connect_notebook", {}),
			status: { type: "running" as const },
		};
		const renderGroup = (parts: ToolCallMessagePartProps[]) => (
			<ActivityGroup group={{ indices: [0, 1, 2] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="reading">
					<ReadActivity {...parts[0]!} />
				</ActivitySubgroup>
				<ActivitySubgroup group={{ indices: [1, 2] }} kind="mcp:notebooks">
					<ToolCallFallback {...parts[1]!} />
					<ToolCallFallback {...parts[2]!} />
				</ActivitySubgroup>
			</ActivityGroup>
		);

		runtime.message.parts = [staleRunningRead, runningNotebook, runningNotebookConnect];
		runtime.message.status = { type: "running" };
		const { getByRole, getByText, rerender } = render(renderGroup(runtime.message.parts));
		expect(getByText("Create notebook")).toBeDefined();

		runtime.message.parts = [
			staleRunningRead,
			{ ...runningNotebook, status: { type: "complete" as const } },
			{ ...runningNotebookConnect, status: { type: "complete" as const } },
		];
		rerender(renderGroup(runtime.message.parts));

		expect(getByRole("button", { name: "Notebooks" })).toBeDefined();
		expect(getByText("Create notebook")).toBeDefined();
	});

	it("keeps the completed tool group open briefly, then collapses it", async () => {
		vi.useFakeTimers();
		const completedRead = readPart("call-1", "/src/mark.svg");
		const runningNotebook = {
			...toolPart("call-2", "notebooks_create_notebook", {}),
			status: { type: "running" as const },
		};
		const runningNotebookConnect = {
			...toolPart("call-3", "notebooks_connect_notebook", {}),
			status: { type: "running" as const },
		};
		const renderGroup = (parts: ToolCallMessagePartProps[]) => (
			<ActivityGroup group={{ indices: [0, 1, 2] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="reading">
					<ReadActivity {...parts[0]!} />
				</ActivitySubgroup>
				<ActivitySubgroup group={{ indices: [1, 2] }} kind="mcp:notebooks">
					<ToolCallFallback {...parts[1]!} />
					<ToolCallFallback {...parts[2]!} />
				</ActivitySubgroup>
			</ActivityGroup>
		);

		runtime.message.parts = [completedRead, runningNotebook, runningNotebookConnect];
		runtime.message.status = { type: "running" };
		const { container, getByRole, getByText, queryByText, rerender } = render(
			renderGroup(runtime.message.parts),
		);

		expect(getByText("Create notebook")).toBeDefined();

		runtime.message.parts = [
			completedRead,
			{ ...runningNotebook, status: { type: "complete" as const } },
			{ ...runningNotebookConnect, status: { type: "complete" as const } },
		];
		// The message stays running while GroupedParts renders "Considering next steps".
		runtime.message.status = { type: "running" };
		rerender(renderGroup(runtime.message.parts));

		expect(getByText("Create notebook")).toBeDefined();
		expect(queryByText("Read mark.svg")).toBeNull();
		expect(queryByText("Show less")).toBeNull();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1599);
		});
		expect(getByText("Create notebook")).toBeDefined();
		expect(queryByText("Read mark.svg")).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(getByRole("button", { name: /tools used/ })).toBeDefined();
		expect(queryByText("Show less")).toBeNull();
		expect(container.querySelector('[data-slot="collapsible-content"]')?.className).toContain(
			"transition-[height]",
		);
	});

	it("shows notebook tool display names without the notebooks prefix", () => {
		const { getByRole, getByText, queryByText } = renderActivity(
			"mcp:notebooks",
			[
				toolPart("call-1", "notebooks_create_notebook", {}),
				toolPart("call-2", "notebooks_connect_notebook", {}),
			],
			ToolCallFallback,
		);
		const trigger = getByRole("button", { name: "Notebooks" });

		expect(queryByText("notebooks_create_notebook")).toBeNull();
		expect(queryByText("Create notebook")).toBeNull();

		fireEvent.click(trigger);
		expect(getByText("Create notebook")).toBeDefined();
		expect(getByText("Connect notebook")).toBeDefined();
		expect(queryByText("notebooks_create_notebook")).toBeNull();
		expect(queryByText("notebooks_connect_notebook")).toBeNull();
	});
});

describe("Self-describing solo tool rows", () => {
	it("does not show subgroup disclosures for running tools in an expanded activity group", () => {
		const completedRead = readPart("call-1", "/src/mark.svg");
		const runningCommands = [
			{
				...toolPart("call-2", "bash", { command: "pnpm lint" }),
				status: { type: "running" as const },
			},
			{
				...toolPart("call-3", "bash", { command: "pnpm test" }),
				status: { type: "running" as const },
			},
		];
		runtime.message.parts = [completedRead, ...runningCommands];
		runtime.message.status = { type: "running" };

		const { baseElement, getByRole, getByText, queryByRole } = render(
			<ActivityGroup group={{ indices: [0, 1, 2] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="reading">
					<ReadActivity {...completedRead} />
				</ActivitySubgroup>
				<ActivitySubgroup group={{ indices: [1, 2] }} kind="terminal">
					{runningCommands.map((part) => (
						<BashTerminal key={part.toolCallId} {...part} />
					))}
				</ActivitySubgroup>
			</ActivityGroup>,
		);

		fireEvent.click(getByRole("button", { name: "Running 2 commands" }));

		expect(baseElement.textContent).toContain("Running 2 commands");
		expect(getByText("pnpm lint")).toBeDefined();
		expect(getByText("pnpm test")).toBeDefined();
		expect(queryByRole("button", { name: "Running 2 commands" })).toBeNull();
	});

	it("does not show a disclosure for a running web subgroup", () => {
		const part = {
			...toolPart("call-1", "websearch", { query: "Numba" }),
			status: { type: "running" as const },
		};
		runtime.message.status = { type: "running" };
		const { baseElement, queryByRole } = renderActivity("web", [part], WebSearchActivity);

		expect(baseElement.textContent).toContain("Browsing the web");
		expect(queryByRole("button")).toBeNull();
	});

	it("renders a quiet solo command as a single non-collapsible line", () => {
		runtime.message.status = { type: "complete" };
		const { baseElement, queryByRole } = renderActivity(
			"terminal",
			[toolPart("call-1", "bash", { command: "pnpm lint" })],
			BashTerminal,
		);

		expect(baseElement.textContent?.trim()).toBe("Ran pnpm lint");
		expect(queryByRole("button")).toBeNull();
	});

	it("keeps a solo command with output expandable", () => {
		const part = {
			...toolPart("call-1", "bash", { command: "pnpm test" }),
			result: JSON.stringify({ stdout: "2 passed\n", exitCode: 0 }),
		};
		runtime.message.status = { type: "complete" };
		const { getByRole, getByText, queryByText } = renderActivity("terminal", [part], BashTerminal);

		expect(queryByText(/2 passed/)).toBeNull();
		fireEvent.click(getByRole("button", { name: "Ran pnpm test" }));
		expect(getByText(/2 passed/)).toBeDefined();
	});

	it("renders a solo task without output as a single non-collapsible line", () => {
		runtime.message.status = { type: "complete" };
		const { baseElement, queryByRole } = renderActivity(
			"subagent",
			[taskPart("call-1", { description: "Explore auth flow", subagent_type: "explore" })],
			TaskActivity,
		);

		expect(baseElement.textContent?.trim()).toBe("Delegated Explore auth flow");
		expect(queryByRole("button")).toBeNull();
	});
});

describe("Activity group settling", () => {
	it("shows diff counts for an edited summary but not the tools-used summary", async () => {
		vi.useFakeTimers();
		const completedRead = readPart("call-1", "/src/example.ts");
		const runningEdit = {
			...toolPart("call-2", "edit", {
				file_path: "/src/example.ts",
				oldString: "const before = true;\n",
				newString: "const after = true;\nconst added = true;\n",
			}),
			status: { type: "running" as const },
		};
		const renderGroup = (parts: ToolCallMessagePartProps[]) => (
			<ActivityGroup group={{ indices: [0, 1] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="reading">
					<ReadActivity {...parts[0]!} />
				</ActivitySubgroup>
				<ActivitySubgroup group={{ indices: [1] }} kind="editing">
					<ToolCallFallback {...parts[1]!} />
				</ActivitySubgroup>
			</ActivityGroup>
		);

		runtime.message.parts = [completedRead, runningEdit];
		runtime.message.status = { type: "running" };
		const { getByRole, getByText, queryByText, rerender } = render(
			renderGroup(runtime.message.parts),
		);

		runtime.message.parts = [
			completedRead,
			{ ...runningEdit, status: { type: "complete" as const } },
		];
		rerender(renderGroup(runtime.message.parts));

		expect(getByRole("button", { name: "Edited example.ts" })).toBeDefined();
		expect(getByText("+2")).toBeDefined();
		expect(getByText("-1")).toBeDefined();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1600);
		});

		expect(getByRole("button", { name: "2 tools used" })).toBeDefined();
		expect(queryByText("+2")).toBeNull();
		expect(queryByText("-1")).toBeNull();
	});

	it("holds a finished single tool's label briefly before collapsing to the summary", async () => {
		vi.useFakeTimers();
		const completedRead = readPart("call-1", "/src/mark.svg");
		const runningCommand = {
			...toolPart("call-2", "bash", { command: "pnpm test" }),
			status: { type: "running" as const },
		};
		const renderGroup = (parts: ToolCallMessagePartProps[]) => (
			<ActivityGroup group={{ indices: [0, 1] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="reading">
					<ReadActivity {...parts[0]!} />
				</ActivitySubgroup>
				<ActivitySubgroup group={{ indices: [1] }} kind="terminal">
					<ToolCallFallback {...parts[1]!} />
				</ActivitySubgroup>
			</ActivityGroup>
		);

		runtime.message.parts = [completedRead, runningCommand];
		runtime.message.status = { type: "running" };
		const { getByRole, queryByRole, rerender } = render(renderGroup(runtime.message.parts));

		expect(getByRole("button", { name: "Running pnpm test" })).toBeDefined();

		runtime.message.parts = [
			completedRead,
			{ ...runningCommand, status: { type: "complete" as const } },
		];
		// The message stays running while GroupedParts renders "Considering next steps".
		runtime.message.status = { type: "running" };
		rerender(renderGroup(runtime.message.parts));

		const settlingTrigger = getByRole("button", { name: "Ran pnpm test" });
		expect(settlingTrigger.getAttribute("aria-expanded")).toBe("false");
		expect(queryByRole("button", { name: /tools used/ })).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1599);
		});
		expect(getByRole("button", { name: "Ran pnpm test" })).toBeDefined();
		expect(queryByRole("button", { name: /tools used/ })).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(getByRole("button", { name: "2 tools used" })).toBeDefined();
		expect(queryByRole("button", { name: "Ran pnpm test" })).toBeNull();
	});
});
