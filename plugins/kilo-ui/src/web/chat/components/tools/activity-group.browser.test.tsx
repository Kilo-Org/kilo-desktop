import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
import { ToolCallFallback } from "./tool-ui-inline.js";
import { ReadActivity } from "./tool-ui-read-search.js";
import { SkillActivity } from "./tool-ui-skill.js";
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

const renderActivity = (
	kind: ActivityKind,
	parts: ToolCallMessagePartProps[],
	Component: ToolCallMessagePartComponent,
) => {
	runtime.message.parts = parts;
	const indices = parts.map((_, index) => index);

	return render(
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

	it("collapses a multi-file read list and lets the user toggle it", () => {
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
		expect(baseElement.textContent?.trim()).toBe("Read 2 files");
		expect(queryByText("mark.svg")).toBeNull();
		expect(queryByText("logo.svg")).toBeNull();
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

	it("collapses multiple skill reads and lets the user toggle them", () => {
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
		expect(queryByText("write-vitest")).toBeNull();
		expect(queryByText("tools")).toBeNull();
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

	it("collapses multiple plan updates and lets the user toggle them", () => {
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
		expect(queryByText("todowrite")).toBeNull();
		expect(queryByText("todoread")).toBeNull();
	});
});

describe("Notebooks activity subgroup", () => {
	it("shows notebook tool display names without the nteract-mcp prefix", () => {
		const { getByRole, getByText, queryByText } = renderActivity(
			"mcp:nteract-mcp",
			[
				toolPart("call-1", "nteract-mcp_create_notebook", {}),
				toolPart("call-2", "nteract-mcp_connect_notebook", {}),
			],
			ToolCallFallback,
		);
		const trigger = getByRole("button", { name: "Notebooks" });

		expect(queryByText("nteract-mcp_create_notebook")).toBeNull();
		expect(queryByText("Create notebook")).toBeNull();

		fireEvent.click(trigger);
		expect(getByText("Create notebook")).toBeDefined();
		expect(getByText("Connect notebook")).toBeDefined();
		expect(queryByText("nteract-mcp_create_notebook")).toBeNull();
		expect(queryByText("nteract-mcp_connect_notebook")).toBeNull();
	});
});
