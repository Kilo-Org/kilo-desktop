import { cleanup, render } from "@testing-library/react";
import { resource, useResource } from "@assistant-ui/tap";
import type { McpAppsHost, ToolCallMessagePartProps } from "@assistant-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ElectronMcpAppRenderer } from "./ElectronMcpAppRenderer.js";

const host: McpAppsHost = {
	loadResource: vi.fn(),
	callTool: vi.fn(),
	readResource: vi.fn(),
	listResources: vi.fn(),
};
const TestHost = resource(() => host);
const testHost = TestHost();

const notebookToolPart = {
	type: "tool-call",
	toolCallId: "notebook-call-1",
	toolName: "notebooks_create_cell",
	args: { cell_type: "code" },
	argsText: JSON.stringify({ cell_type: "code" }),
	status: { type: "complete" as const },
	addResult: vi.fn(),
	resume: vi.fn(),
	respondToApproval: vi.fn(),
	mcp: {
		app: {
			resourceUri: "ui://notebooks/create-cell",
			serverId: "notebooks",
		},
	},
} as ToolCallMessagePartProps;

const localMcpAppPart = {
	...notebookToolPart,
	toolCallId: "environment-call-1",
	toolName: "desktop_environments_conda_envs_list",
	mcp: {
		app: {
			resourceUri: "ui://environments/conda-envs-list",
			serverId: "desktop",
		},
	},
} as ToolCallMessagePartProps;

function TestRenderer({ part }: { part: ToolCallMessagePartProps }) {
	const { render: Render } = useResource(ElectronMcpAppRenderer({ host: testHost }));
	return <Render {...part} />;
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ElectronMcpAppRenderer", () => {
	it("renders the normal tool row when an MCP App is not hostable", () => {
		const { getByText } = render(<TestRenderer part={notebookToolPart} />);

		expect(getByText("Create cell")).toBeDefined();
		expect(host.loadResource).not.toHaveBeenCalled();
	});

	it("continues loading approved local MCP Apps", () => {
		vi.mocked(host.loadResource).mockReturnValue(new Promise(() => undefined));

		const { getByText, queryByText } = render(<TestRenderer part={localMcpAppPart} />);

		expect(getByText("Loading MCP App…")).toBeDefined();
		expect(queryByText("Environments conda envs list")).toBeNull();
		expect(host.loadResource).toHaveBeenCalledWith({
			uri: "ui://environments/conda-envs-list",
			serverId: "desktop",
		});
	});
});
