import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KernelProvider } from "@kilo-desktop/kernel/web";

import { renderInKernel } from "../../test/kernel-harness";

const runtime = vi.hoisted(() => ({
	message: {
		id: "message-1",
		parts: [] as ToolCallMessagePartProps[],
		status: { type: "complete" },
		metadata: undefined as unknown,
	},
	thread: { extras: undefined as unknown },
	threadListItem: { id: "thread-1", remoteId: "session-1" },
	permissions: [] as Array<{
		tool?: { messageID?: string; callID?: string } | undefined;
	}>,
}));
vi.mock("@assistant-ui/react", () => ({
	useAuiState: (selector: (state: typeof runtime) => unknown) => selector(runtime),
	useScrollLock: () => () => undefined,
}));

vi.mock("@assistant-ui/react-opencode", () => ({
	useOpenCodeQuestions: () => [],
	useOpenCodePermissions: () => ({ pending: runtime.permissions, reply: vi.fn() }),
	projectOpenCodeThreadMessages: () => [],
}));

import { ActivityGroup, ActivitySubgroup, ManualDisclosureProvider } from "./activity-group";
import { ApplyPatchDiff } from "./tool-ui-apply-patch";
import { BashTerminal } from "./tool-ui-bash";
import { ToolCallFallback } from "./tool-ui-inline";
import { ReadActivity } from "./tool-ui-read-search";
import { SkillActivity } from "./tool-ui-skill";
import { WebFetchActivity, WebSearchActivity } from "./tool-ui-web";
import type { ActivityKind } from "./tool-categories";
import type { ToolCallComponent } from "./tool-call";

/**
 * Renders `ui` in a booted test kernel (the tool rows read kilo.shell's theme
 * and kilo.chat's auto-approve state). Fake timers start after the kernel has
 * booted, so only the component's own timers are faked.
 */
async function mount(ui: ReactNode, { fakeTimers = false } = {}) {
	const host = await renderInKernel(null);
	if (fakeTimers) vi.useFakeTimers();
	const wrap = (node: ReactNode) => <KernelProvider kernel={host.renderer}>{node}</KernelProvider>;
	host.view.rerender(wrap(ui));
	return { ...host.view, rerender: (node: ReactNode) => host.view.rerender(wrap(node)) };
}

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
const renderActivity = (
	kind: ActivityKind,
	parts: ToolCallMessagePartProps[],
	Component: ToolCallComponent,
) => {
	runtime.message.parts = parts;
	const indices = parts.map((_, index) => index);

	return mount(
		<ActivityGroup group={{ indices }}>
			<ActivitySubgroup group={{ indices }} kind={kind}>
				{parts.map((part) => (
					<Component key={part.toolCallId} {...part} />
				))}
			</ActivitySubgroup>
		</ActivityGroup>,
	);
};

afterEach(() => {
	cleanup();
	runtime.permissions.length = 0;
	runtime.message.metadata = undefined;
	runtime.thread.extras = undefined;
	vi.useRealTimers();
});

describe("Reading activity subgroup", () => {
	it("renders one read as a single non-collapsible line", async () => {
		const { baseElement, queryByRole } = await renderActivity(
			"reading",
			[readPart("call-1", "/src/mark.svg")],
			ReadActivity,
		);

		expect(baseElement.textContent?.trim()).toBe("Read mark.svg");
		expect(queryByRole("button")).toBeNull();
	});

	it("collapses a multi-file read list and lets the user toggle it", async () => {
		const { baseElement, getByRole, getByText, queryByText } = await renderActivity(
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

	it("keeps a single running read collapsed when reasoning shares the activity group", async () => {
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

		const { getByRole } = await mount(
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

	it("keeps a single running tool collapsed after earlier completed tools", async () => {
		const completedRead = readPart("call-1", "/src/mark.svg");
		const runningCommand = {
			...toolPart("call-2", "bash", { command: "gh run view --job 104579955735" }),
			status: { type: "running" as const },
		};
		runtime.message.parts = [completedRead, runningCommand];
		runtime.message.status = { type: "running" };

		const { getByRole, queryByText } = await mount(
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
	it("renders one skill read as a single non-collapsible line", async () => {
		const { baseElement, queryByRole } = await renderActivity(
			"skill",
			[skillPart("call-1", "write-vitest")],
			SkillActivity,
		);

		expect(baseElement.textContent?.trim()).toBe("Read Skill write-vitest");
		expect(queryByRole("button")).toBeNull();
	});

	it("collapses multiple skill reads and lets the user toggle them", async () => {
		const { getByRole, getByText, queryByText } = await renderActivity(
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

describe("Editing activity subgroup", () => {
	it("renders a multi-file patch as collapsed per-file rows", async () => {
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
		const { container, getByRole, queryByText } = await renderActivity(
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
	it("does not count hidden OpenCode lifecycle parts as web requests", async () => {
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

		const { getByRole, queryByRole } = await mount(
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
	it("keeps solo active thinking expanded", async () => {
		const thoughtText = "I am checking the workflow failure.";
		const runningThought = {
			type: "reasoning",
			text: thoughtText,
			status: { type: "running" as const },
		} as unknown as ToolCallMessagePartProps;
		runtime.message.parts = [runningThought];
		runtime.message.status = { type: "running" };

		const { getByRole, getByText } = await mount(
			<ActivityGroup group={{ indices: [0] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="thinking">
					<div>{thoughtText}</div>
				</ActivitySubgroup>
			</ActivityGroup>,
		);

		expect(getByRole("button", { name: "Thinking..." }).getAttribute("aria-expanded")).toBe("true");
		expect(getByText(thoughtText)).toBeDefined();
	});

	it("keeps active thinking expanded after an earlier tool", async () => {
		const completedRead = readPart("call-1", "/src/mark.svg");
		const thoughtText = "I am checking the workflow failure.";
		const runningThought = {
			type: "reasoning",
			text: thoughtText,
			status: { type: "running" as const },
		} as unknown as ToolCallMessagePartProps;
		runtime.message.parts = [completedRead, runningThought];
		runtime.message.status = { type: "running" };

		const { getByRole, getByText } = await mount(
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

	it("hides a finished board read while later thinking streams", async () => {
		const boardRead = {
			...toolPart("board-1", "board_read", {}),
			result: "No new messages.",
		};
		const thoughtText = "I am reasoning through the merged report.";
		const runningThought = {
			type: "reasoning",
			text: thoughtText,
			status: { type: "running" as const },
		} as unknown as ToolCallMessagePartProps;
		runtime.message.parts = [boardRead, runningThought];
		runtime.message.status = { type: "running" };

		const { getByRole, getByText, queryByText } = await mount(
			<ActivityGroup group={{ indices: [0, 1] }}>
				<ActivitySubgroup group={{ indices: [0] }} kind="subagent">
					<ToolCallFallback {...boardRead} />
				</ActivitySubgroup>
				<ActivitySubgroup group={{ indices: [1] }} kind="thinking">
					<div>{thoughtText}</div>
				</ActivitySubgroup>
			</ActivityGroup>,
		);

		expect(getByRole("button", { name: "Thinking..." }).getAttribute("aria-expanded")).toBe("true");
		expect(getByText(thoughtText)).toBeDefined();
		expect(queryByText("Read agent messages")).toBeNull();
	});
});

describe("Notebooks activity subgroup", () => {
	it("never moves the active subgroup back to an earlier stale-running tool", async () => {
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
		const { getByRole, getByText, rerender } = await mount(renderGroup(runtime.message.parts));
		expect(getByText("Create notebook")).toBeDefined();

		runtime.message.parts = [
			staleRunningRead,
			{ ...runningNotebook, status: { type: "complete" as const } },
			{ ...runningNotebookConnect, status: { type: "complete" as const } },
		];
		rerender(renderGroup(runtime.message.parts));

		expect(getByRole("button", { name: "Notebook" })).toBeDefined();
		expect(getByText("Create notebook")).toBeDefined();
	});

	it("keeps the completed tool group open briefly, then collapses it", async () => {
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
		const { container, getByRole, getByText, queryByText, rerender } = await mount(
			renderGroup(runtime.message.parts),
			{ fakeTimers: true },
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

	it("shows notebook tool display names without the notebooks prefix", async () => {
		const { getByRole, getByText, queryByText } = await renderActivity(
			"mcp:notebooks",
			[
				toolPart("call-1", "notebooks_create_notebook", {}),
				toolPart("call-2", "notebooks_connect_notebook", {}),
			],
			ToolCallFallback,
		);
		const trigger = getByRole("button", { name: "Notebook" });

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
	it("preserves a manually expanded parent group when its activity subtree remounts", async () => {
		const read = readPart("call-1", "/src/mark.svg");
		const command = toolPart("call-2", "bash", { command: "pnpm test" });
		runtime.message.parts = [read, command];
		const view = (revision: string) => (
			<ManualDisclosureProvider>
				<div key={revision}>
					<ActivityGroup group={{ indices: [0, 1] }}>
						<ActivitySubgroup group={{ indices: [0] }} kind="reading">
							<ReadActivity {...read} />
						</ActivitySubgroup>
						<ActivitySubgroup group={{ indices: [1] }} kind="terminal">
							<BashTerminal {...command} />
						</ActivitySubgroup>
					</ActivityGroup>
				</div>
			</ManualDisclosureProvider>
		);
		const { getByRole, rerender } = await mount(view("streaming"));
		const trigger = getByRole("button", { name: "2 tools used" });

		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");

		rerender(view("complete"));
		expect(getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
	});

	it("keeps a manually expanded streaming parent open when a subgroup joins", async () => {
		const read = readPart("call-1", "/src/mark.svg");
		const command = {
			...toolPart("call-2", "bash", { command: "pnpm test" }),
			status: { type: "running" as const },
		};
		const search = {
			...toolPart("call-3", "websearch", { query: "Vitest" }),
			status: { type: "running" as const },
		};
		const view = (parts: ToolCallMessagePartProps[]) => {
			runtime.message.parts = parts;
			const indices = parts.map((_, index) => index);
			return (
				<ManualDisclosureProvider>
					<div key={parts.length}>
						<ActivityGroup group={{ indices }}>
							<ActivitySubgroup group={{ indices: [0] }} kind="reading">
								<ReadActivity {...read} />
							</ActivitySubgroup>
							<ActivitySubgroup group={{ indices: [1] }} kind="terminal">
								<BashTerminal {...command} />
							</ActivitySubgroup>
							{parts.length > 2 ? (
								<ActivitySubgroup group={{ indices: [2] }} kind="web">
									<WebSearchActivity {...search} />
								</ActivitySubgroup>
							) : null}
						</ActivityGroup>
					</div>
				</ManualDisclosureProvider>
			);
		};
		runtime.message.status = { type: "running" };
		const { getByRole, rerender } = await mount(view([read, command]));

		fireEvent.click(getByRole("button", { name: "Running pnpm test" }));
		expect(getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");

		rerender(view([read, command, search]));
		expect(getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
	});

	it("keeps an expanded row from the first subgroup visible when activity advances", async () => {
		const completedCommand = {
			...toolPart("call-1", "bash", { command: "pnpm test" }),
			result: JSON.stringify({ stdout: "2 passed\n", exitCode: 0 }),
		};
		const runningCommand = {
			...toolPart("call-2", "bash", { command: "pnpm lint" }),
			status: { type: "running" as const },
		};
		const search = {
			...toolPart("call-3", "websearch", { query: "Vitest" }),
			status: { type: "running" as const },
		};
		const view = (parts: ToolCallMessagePartProps[]) => {
			runtime.message.parts = parts;
			return (
				<ManualDisclosureProvider>
					<div key={parts.length}>
						<ActivityGroup group={{ indices: parts.map((_, index) => index) }}>
							<ActivitySubgroup group={{ indices: [0, 1] }} kind="terminal">
								<BashTerminal {...completedCommand} />
								<BashTerminal {...runningCommand} />
							</ActivitySubgroup>
							{parts.length > 2 ? (
								<ActivitySubgroup group={{ indices: [2] }} kind="web">
									<WebSearchActivity {...search} />
								</ActivitySubgroup>
							) : null}
						</ActivityGroup>
					</div>
				</ManualDisclosureProvider>
			);
		};
		runtime.message.status = { type: "running" };
		const { getByRole, getByText, rerender } = await mount(
			view([completedCommand, runningCommand]),
		);

		fireEvent.click(getByRole("button", { name: "Ran pnpm test" }));
		expect(getByText(/2 passed/)).toBeDefined();

		rerender(view([completedCommand, runningCommand, search]));
		expect(getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
		expect(getByText(/2 passed/)).toBeDefined();
	});

	it("does not show subgroup disclosures for running tools in an expanded activity group", async () => {
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

		const { baseElement, getByRole, getByText, queryByRole } = await mount(
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

	it("does not show a disclosure for a running web subgroup", async () => {
		const part = {
			...toolPart("call-1", "websearch", { query: "Numba" }),
			status: { type: "running" as const },
		};
		runtime.message.status = { type: "running" };
		const { baseElement, queryByRole } = await renderActivity("web", [part], WebSearchActivity);

		expect(baseElement.textContent).toContain("Browsing the web");
		expect(queryByRole("button")).toBeNull();
	});

	it("renders a quiet solo command as a single non-collapsible line", async () => {
		runtime.message.status = { type: "complete" };
		const { baseElement, queryByRole } = await renderActivity(
			"terminal",
			[toolPart("call-1", "bash", { command: "pnpm lint" })],
			BashTerminal,
		);

		expect(baseElement.textContent?.trim()).toBe("Ran pnpm lint");
		expect(queryByRole("button")).toBeNull();
	});

	it("keeps a solo command with output expandable", async () => {
		const part = {
			...toolPart("call-1", "bash", { command: "pnpm test" }),
			result: JSON.stringify({ stdout: "2 passed\n", exitCode: 0 }),
		};
		runtime.message.status = { type: "complete" };
		const { getByRole, getByText, queryByText } = await renderActivity(
			"terminal",
			[part],
			BashTerminal,
		);

		expect(queryByText(/2 passed/)).toBeNull();
		fireEvent.click(getByRole("button", { name: "Ran pnpm test" }));
		expect(getByText(/2 passed/)).toBeDefined();
	});

	it("expands the tool detail while its permission request is pending", async () => {
		const command = {
			...toolPart("call-1", "bash", { command: "pnpm test" }),
			status: { type: "running" as const },
		};
		runtime.message.status = { type: "running" };
		runtime.permissions.push({ tool: { messageID: "message-1", callID: "call-1" } });

		const { getByRole, getByText } = await renderActivity("terminal", [command], BashTerminal);

		expect(getByRole("button", { name: "Running pnpm test" }).getAttribute("aria-expanded")).toBe(
			"true",
		);
		expect(getByText("$ pnpm test")).toBeDefined();
	});

	it("preserves an expanded command when its activity subtree remounts", async () => {
		const command = {
			...toolPart("call-1", "bash", { command: "pnpm test" }),
			result: JSON.stringify({ stdout: "2 passed\n", exitCode: 0 }),
		};
		const otherCommand = toolPart("call-2", "bash", { command: "pnpm lint" });
		runtime.message.parts = [command, otherCommand];
		const view = (revision: string) => (
			<ManualDisclosureProvider>
				<div key={revision}>
					<ActivityGroup group={{ indices: [0, 1] }}>
						<ActivitySubgroup group={{ indices: [0, 1] }} kind="terminal">
							<BashTerminal {...command} />
							<BashTerminal {...otherCommand} />
						</ActivitySubgroup>
					</ActivityGroup>
				</div>
			</ManualDisclosureProvider>
		);
		const { getByRole, getByText, rerender } = await mount(view("streaming"));

		fireEvent.click(getByRole("button", { name: "Ran 2 commands" }));
		fireEvent.click(getByRole("button", { name: "Ran pnpm test" }));
		expect(getByText(/2 passed/)).toBeDefined();

		rerender(view("complete"));
		expect(getByText(/2 passed/)).toBeDefined();
		expect(getByRole("button", { name: "Ran pnpm test" }).getAttribute("aria-expanded")).toBe(
			"true",
		);
	});
});

describe("Activity group settling", () => {
	it("shows diff counts for an edited summary but not the tools-used summary", async () => {
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
		const { getByRole, getByText, queryByText, rerender } = await mount(
			renderGroup(runtime.message.parts),
			{ fakeTimers: true },
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
		const { getByRole, queryByRole, rerender } = await mount(renderGroup(runtime.message.parts), {
			fakeTimers: true,
		});

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
