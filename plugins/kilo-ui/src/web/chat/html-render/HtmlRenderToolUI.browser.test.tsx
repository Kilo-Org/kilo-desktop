import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import { Toaster } from "@kilo-desktop/ui/components/sonner";

import { kiloUiChatContract, type KiloUiChatService } from "../../../contracts/chat/schemas.js";
import { ChatMarkdownProvider } from "../ChatMarkdownContext.js";
import { TurnWorkFoldContext } from "../components/tools/turn-work-fold-context.js";
import { HtmlRenderToolUI } from "./HtmlRenderToolUI.js";

afterEach(() => {
	cleanup();
});

function renderTool(
	props: Partial<ToolCallMessagePartProps>,
	{
		inFold = false,
		workspaceDirectory,
		saveHtmlPage = vi.fn(),
	}: {
		inFold?: boolean;
		workspaceDirectory?: string;
		saveHtmlPage?: KiloUiChatService["chat.saveHtmlPage"];
	} = {},
) {
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: kiloUiChatContract,
		handlers: { "chat.saveHtmlPage": saveHtmlPage },
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const toolProps = {
		type: "tool-call",
		toolCallId: "call-1",
		toolName: "desktop_kilo_ui_html_render",
		args: {},
		argsText: "",
		status: { type: "complete" },
		...props,
	} as ToolCallMessagePartProps;
	const tool = (
		<TurnWorkFoldContext.Provider value={inFold}>
			<HtmlRenderToolUI {...toolProps} />
		</TurnWorkFoldContext.Provider>
	);
	const openExternal = vi.spyOn(sdk.shell, "openExternal").mockResolvedValue({ opened: true });
	const view = render(
		<SdkProvider system={system}>
			<Toaster />
			{workspaceDirectory ? (
				<ChatMarkdownProvider
					sessionId="session-1"
					workspaceFolders={[{ path: workspaceDirectory, isPrimary: true }]}
				>
					{tool}
				</ChatMarkdownProvider>
			) : (
				tool
			)}
		</SdkProvider>,
	);
	return { ...view, openExternal };
}

const frameHeight = (title: string) => (screen.getByTitle(title) as HTMLIFrameElement).style.height;

describe("HtmlRenderToolUI", () => {
	it("fits the sandboxed frame to the height the page reports", async () => {
		renderTool({
			args: { title: "Chart", html: '<div style="height:500px">chart</div>' },
		});

		const frame = screen.getByTitle("Chart");
		expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
		await waitFor(() => expect(frameHeight("Chart")).toBe("500px"));
	});

	it("saves a standalone copy of the page to the chat's workspace", async () => {
		const saveHtmlPage = vi.fn(async () => ({ relativePath: "Chart.html" }));
		renderTool(
			{ args: { title: "Chart", html: "<p>chart</p>" } },
			{ workspaceDirectory: "/workspace/project", saveHtmlPage },
		);

		fireEvent.click(screen.getByRole("button", { name: "Save Chart to workspace" }));

		await waitFor(() => expect(screen.getByText("Saved Chart.html")).toBeTruthy());
		expect(saveHtmlPage).toHaveBeenCalledWith({
			workspaceDirectory: "/workspace/project",
			title: "Chart",
			html: expect.stringMatching(/html\{background:var\(--background\)\}[\s\S]*<p>chart<\/p>/),
		});
	});

	it("offers no save outside a chat with a workspace", () => {
		renderTool({ args: { title: "Chart", html: "<p>chart</p>" } });

		expect(screen.queryByRole("button", { name: "Save Chart to workspace" })).toBeNull();
	});

	it("opens a link the page asks for only after the reader confirms it", async () => {
		const { openExternal } = renderTool({ args: { title: "Chart", html: "<p>chart</p>" } });
		const frame = screen.getByTitle("Chart") as HTMLIFrameElement;
		// Any recent click in the app window counts as activation; the page can
		// time its request to it, so activation alone must not open anything.
		await userEvent.click(document.body);

		window.dispatchEvent(
			new MessageEvent("message", {
				source: frame.contentWindow,
				data: {
					jsonrpc: "2.0",
					id: "kilo-link-1",
					method: "ui/open-link",
					params: { url: "https://example.com/report?q=1" },
				},
			}),
		);

		await waitFor(() => expect(screen.getByText("Open example.com in your browser?")).toBeTruthy());
		expect(openExternal).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(openExternal).toHaveBeenCalledWith("https://example.com/report?q=1");
	});

	it("caps the frame at the requested height", async () => {
		renderTool({
			args: { title: "Table", height: 300, html: '<div style="height:900px">rows</div>' },
		});

		await waitFor(() => expect(frameHeight("Table")).toBe("300px"));
	});

	it("leaves a shown page to the message inside a settled fold, but keeps a failure there", () => {
		const { container, unmount } = renderTool(
			{ args: { title: "Chart", html: "<p>x</p>" } },
			{ inFold: true },
		);
		expect(container.querySelector("iframe")).toBeNull();
		unmount();

		renderTool(
			{
				args: { title: "Chart", html: "<p>x</p>" },
				status: { type: "incomplete", reason: "error" },
				result: "Tool failed",
			},
			{ inFold: true },
		);
		expect(screen.getByText("Couldn't show Chart")).toBeTruthy();
	});

	it("shows a placeholder while the call runs and an error row when it fails", () => {
		const { unmount } = renderTool({
			args: { title: "Chart", html: "<p>x</p>" },
			status: { type: "running" },
		});
		expect(screen.getByLabelText("Rendering page")).toBeTruthy();
		unmount();

		renderTool({
			args: { title: "Chart", html: "<p>x</p>" },
			status: { type: "incomplete", reason: "error" },
			result: "Tool failed",
		});
		expect(screen.getByText("Couldn't show Chart")).toBeTruthy();
		expect(screen.getByText(/Tool failed/)).toBeTruthy();
	});
});
