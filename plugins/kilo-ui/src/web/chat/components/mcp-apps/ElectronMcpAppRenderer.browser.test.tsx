import { cleanup, render, waitFor } from "@testing-library/react";
import { resource, useResource } from "@assistant-ui/tap";
import type { McpAppResource, McpAppsHost, ToolCallMessagePartProps } from "@assistant-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	MCP_APP_SHELL_HTML_MESSAGE,
	MCP_APP_SHELL_READY_MESSAGE,
} from "../../../../contracts/mcp-apps/schemas.js";
import { ElectronMcpAppRenderer } from "./ElectronMcpAppRenderer.js";

const host: McpAppsHost = {
	loadResource: vi.fn(),
	callTool: vi.fn(),
	readResource: vi.fn(),
	listResources: vi.fn(),
};
const TestHost = resource(() => host);
const testHost = TestHost();
// A stable options object so `ElectronMcpAppRenderer` memoizes one `Render`
// across rerenders; a fresh object each render would recreate `Render` and
// remount the frame on its own, masking what the reload test below asserts.
const rendererOptions = { host: testHost };

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
	const { render: Render } = useResource(ElectronMcpAppRenderer(rendererOptions));
	return <Render {...part} />;
}

function mcpAppPartFor(resourceUri: string): ToolCallMessagePartProps {
	return {
		...localMcpAppPart,
		mcp: { app: { resourceUri, serverId: "desktop" } },
	} as ToolCallMessagePartProps;
}

function widgetResource(html: string): McpAppResource {
	return { uri: "ui://x", mimeType: "text/html;profile=mcp-app", html };
}

// Stands in for the isolated shell on the blob path (the custom-scheme shell
// origin can't be exercised in the browser harness). It reports "test/loaded"
// once its listener is registered, optionally announces shell readiness, and
// echoes back any HTML the renderer hands it — so the test can observe the
// renderer's side of the handshake through a real iframe + postMessage.
function fakeShellHtml({ announceReady }: { announceReady: boolean }): string {
	return `<!doctype html><html><body><script>
		window.addEventListener("message", function (event) {
			if (event.source !== window.parent) return;
			var data = event.data;
			if (data && data.type === ${JSON.stringify(MCP_APP_SHELL_HTML_MESSAGE)} && typeof data.html === "string") {
				window.parent.postMessage({ type: "test/echo", html: data.html }, "*");
			}
		});
		window.parent.postMessage({ type: "test/loaded" }, "*");
		${announceReady ? `window.parent.postMessage({ type: ${JSON.stringify(MCP_APP_SHELL_READY_MESSAGE)} }, "*");` : ""}
	</script></body></html>`;
}

function onceMessage(predicate: (data: { type?: string }) => boolean): Promise<{ type?: string }> {
	return new Promise((resolve) => {
		const handler = (event: MessageEvent) => {
			if (predicate(event.data ?? {})) {
				window.removeEventListener("message", handler);
				resolve(event.data);
			}
		};
		window.addEventListener("message", handler);
	});
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

		expect(getByText("Loading MCP app…")).toBeDefined();
		expect(queryByText("Environments conda envs list")).toBeNull();
		expect(host.loadResource).toHaveBeenCalledWith({
			uri: "ui://environments/conda-envs-list",
			serverId: "desktop",
		});
	});

	it("reloads the frame when the widget HTML changes", async () => {
		// The isolated Electron shell accepts widget HTML exactly once (it drops
		// its own message listener before the first document.write), so new HTML
		// for an already-mounted frame must force a fresh iframe load or the widget
		// silently keeps showing stale content. The shell origin can't be
		// exercised here (no custom scheme in the browser test), but the reload it
		// depends on surfaces on the blob path as the iframe element being
		// remounted rather than reused; that remount is the regression guard. The
		// shell handshake itself is covered by manual/e2e checks.
		vi.mocked(host.loadResource).mockImplementation(({ uri }) =>
			Promise.resolve(widgetResource(`<!doctype html><title>${uri}</title>`)),
		);

		const { container, rerender, findByTitle } = render(
			<TestRenderer part={mcpAppPartFor("ui://environments/a")} />,
		);
		const firstFrame = await findByTitle("MCP App");

		rerender(<TestRenderer part={mcpAppPartFor("ui://environments/b")} />);

		await waitFor(() => {
			const currentFrame = container.querySelector('iframe[title="MCP App"]');
			expect(currentFrame).not.toBeNull();
			expect(currentFrame).not.toBe(firstFrame);
		});
	});

	it("hands the widget HTML to the shell when it announces readiness", async () => {
		const shellHtml = fakeShellHtml({ announceReady: true });
		vi.mocked(host.loadResource).mockResolvedValue(widgetResource(shellHtml));
		const echo = onceMessage((data) => data.type === "test/echo");

		render(<TestRenderer part={mcpAppPartFor("ui://environments/a")} />);

		// The shell announced READY; the renderer must post the widget HTML back,
		// which the shell echoes. Getting the same HTML confirms the round-trip.
		const received = (await echo) as { html: string };
		expect(received.html).toBe(shellHtml);
	});

	it("tells the widget when the tool result is an error", async () => {
		// A failed call's result is the error text; without the flag the widget
		// tries to parse it as data and reports a parse failure instead.
		const widgetHtml = `<!doctype html><html><body><script>
			window.addEventListener("message", function (event) {
				if (event.source !== window.parent) return;
				var data = event.data;
				if (data && data.method === "ui/notifications/tool-result") {
					window.parent.postMessage({ type: "test/tool-result", params: data.params }, "*");
				}
			});
			window.parent.postMessage({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} }, "*");
		</script></body></html>`;
		vi.mocked(host.loadResource).mockResolvedValue(widgetResource(widgetHtml));
		const toolResult = onceMessage((data) => data.type === "test/tool-result");

		render(
			<TestRenderer
				part={
					{
						...mcpAppPartFor("ui://environments/a"),
						result: "MCP error -32000: Connection closed",
						isError: true,
					} as ToolCallMessagePartProps
				}
			/>,
		);

		const received = (await toolResult) as { params: unknown };
		expect(received.params).toEqual({
			content: [{ type: "text", text: "MCP error -32000: Connection closed" }],
			isError: true,
		});
	});

	it("ignores shell-ready messages from foreign sources", async () => {
		const shellHtml = fakeShellHtml({ announceReady: false });
		vi.mocked(host.loadResource).mockResolvedValue(widgetResource(shellHtml));

		let echoed = false;
		const onEcho = (event: MessageEvent) => {
			if ((event.data as { type?: string } | null)?.type === "test/echo") echoed = true;
		};
		window.addEventListener("message", onEcho);

		render(<TestRenderer part={mcpAppPartFor("ui://environments/a")} />);
		// Wait until the frame's listener is up so a mis-accepted READY would in
		// fact produce an echo (otherwise the negative could pass on timing alone).
		await onceMessage((data) => data.type === "test/loaded");

		// A READY whose source is the host window — not the frame's own window —
		// must be rejected, so the renderer never hands over the HTML (no echo).
		window.postMessage({ type: MCP_APP_SHELL_READY_MESSAGE }, "*");
		await new Promise((resolve) => setTimeout(resolve, 250));

		expect(echoed).toBe(false);
		window.removeEventListener("message", onEcho);
	});
});
