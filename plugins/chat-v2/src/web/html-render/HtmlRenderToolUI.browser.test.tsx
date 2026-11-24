import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { definePlugin } from "@kilo-desktop/kernel";
import { Toaster } from "@kilo-desktop/ui/components/sonner";

import {
	HtmlPages,
	htmlPageFileStem,
	MCP_APP_SHELL_HTML_MESSAGE,
	MCP_APP_SHELL_READY_MESSAGE,
	type SaveHtmlPageInput,
} from "../../contracts";
import { renderInKernel } from "../../test/kernel-harness";
import type { ToolCallView } from "../tools/tool-call";
import { ChatMarkdownProvider } from "../thread/chat-markdown";
import { TurnWorkFoldContext } from "../tools/turn-work-fold-context";
import { HtmlRenderToolUI } from "./HtmlRenderToolUI";

type WriteNewFile = (path: string, content: string) => Promise<boolean>;

/** kilo.chat's `html-pages` in main, writing through `writeNewFile` (false: the name is taken). */
const htmlPagesMain = (writeNewFile: WriteNewFile) =>
	definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(HtmlPages, {
				initialState: {},
				methods: {
					save: async ({ workspaceDirectory, title, html }: SaveHtmlPageInput) => {
						const stem = htmlPageFileStem(title);
						for (let index = 1; ; index++) {
							const relativePath = index === 1 ? `${stem}.html` : `${stem} ${index}.html`;
							if (await writeNewFile(`${workspaceDirectory}/${relativePath}`, html)) {
								return { relativePath };
							}
						}
					},
				},
			});
		},
	});

async function renderTool(
	props: Partial<ToolCallView>,
	{
		inFold = false,
		workspaceDirectory,
		writeNewFile = vi.fn(async () => true),
	}: {
		inFold?: boolean;
		workspaceDirectory?: string;
		writeNewFile?: WriteNewFile;
	} = {},
) {
	const toolProps = {
		toolCallId: "call-1",
		toolName: "desktop_chat_html_render",
		args: {},
		argsText: "",
		status: { type: "complete" },
		...props,
	} as ToolCallView;
	const tool = (
		<TurnWorkFoldContext.Provider value={inFold}>
			<HtmlRenderToolUI {...toolProps} />
		</TurnWorkFoldContext.Provider>
	);
	const host = await renderInKernel(
		<>
			<Toaster />
			{workspaceDirectory ? (
				<ChatMarkdownProvider
					workSessionId="session-1"
					workspaceFolders={[{ path: workspaceDirectory, isPrimary: true }]}
				>
					{tool}
				</ChatMarkdownProvider>
			) : (
				tool
			)}
		</>,
		{ chatMain: htmlPagesMain(writeNewFile) },
	);
	return { ...host.view, opened: host.opened };
}

const frameHeight = (title: string) => (screen.getByTitle(title) as HTMLIFrameElement).style.height;

describe("HtmlRenderToolUI", () => {
	it("fits the sandboxed frame to the height the page reports", async () => {
		await renderTool({
			args: { title: "Chart", html: '<div style="height:500px">chart</div>' },
		});

		const frame = screen.getByTitle("Chart");
		expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
		await waitFor(() => expect(frameHeight("Chart")).toBe("500px"));
	});

	it("saves a standalone copy of the page to the chat's workspace, never overwriting", async () => {
		const existing = new Set(["/workspace/project/Chart.html"]);
		const writeNewFile = vi.fn(async (path: string) => !existing.has(path));
		await renderTool(
			{ args: { title: "Chart", html: "<p>chart</p>" } },
			{ workspaceDirectory: "/workspace/project", writeNewFile },
		);

		fireEvent.click(screen.getByRole("button", { name: "Save Chart to workspace" }));

		await waitFor(() => expect(screen.getByText("Saved Chart 2.html")).toBeTruthy(), {
			timeout: 5_000,
		});
		expect(writeNewFile).toHaveBeenLastCalledWith(
			"/workspace/project/Chart 2.html",
			expect.stringMatching(/html\{background:var\(--background\)\}[\s\S]*<p>chart<\/p>/),
		);
	});

	it("offers no save outside a chat with a workspace", async () => {
		await renderTool({ args: { title: "Chart", html: "<p>chart</p>" } });

		expect(screen.queryByRole("button", { name: "Save Chart to workspace" })).toBeNull();
	});

	it("opens a link the page asks for only after the reader confirms it", async () => {
		const { opened } = await renderTool({ args: { title: "Chart", html: "<p>chart</p>" } });
		const frame = screen.getByTitle("Chart") as HTMLIFrameElement;
		// Any recent click in the app window counts as activation; the page can
		// time its request to it, so activation alone must not open anything.
		// Clicked outside the frame: a click landing on the loading frame races
		// its navigation and detaches it under load.
		const elsewhere = document.body.appendChild(document.createElement("button"));
		elsewhere.textContent = "Elsewhere";
		onTestFinished(() => elsewhere.remove());
		await userEvent.click(elsewhere);

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
		expect(opened).toEqual([]);
		fireEvent.click(screen.getByRole("button", { name: "Open" }));
		await waitFor(() => expect(opened).toEqual(["https://example.com/report?q=1"]));
	});

	it("opens the page full window where there's no Viewer pane", async () => {
		await renderTool({ args: { title: "Chart", html: "<p>chart</p>" } });

		fireEvent.click(screen.getByRole("button", { name: "Open Chart in viewer" }));

		const dialog = await screen.findByRole("dialog", { name: "Chart" });
		expect(dialog.querySelector('iframe[title="Chart"]')).not.toBeNull();
		expect(dialog.querySelector('[data-qa-id="media-lightbox-zoom-in"]')).toBeNull();
	});

	it("hands the page to its frame only once, even after the frame navigates to a fresh shell", async () => {
		const kinds: string[] = [];
		const onMessage = (event: MessageEvent) => {
			if (typeof event.data?.kind === "string") kinds.push(event.data.kind);
		};
		window.addEventListener("message", onMessage);
		// A shell (e.g. the MCP App widget shell, under a looser policy) the page
		// could navigate its frame to: it announces readiness like the real one.
		const freshShell = `<script>
			addEventListener("message", (e) => {
				if (e.data && e.data.type === ${JSON.stringify(MCP_APP_SHELL_HTML_MESSAGE)}) parent.postMessage({ kind: "redelivered" }, "*");
			});
			parent.postMessage({ type: ${JSON.stringify(MCP_APP_SHELL_READY_MESSAGE)} }, "*");
			setTimeout(() => parent.postMessage({ kind: "settled" }, "*"), 500);
		</script>`;
		const html = `<script>
			addEventListener("message", (e) => {
				if (!e.data || e.data.type !== ${JSON.stringify(MCP_APP_SHELL_HTML_MESSAGE)}) return;
				parent.postMessage({ kind: "delivered" }, "*");
				location.href = "data:text/html," + encodeURIComponent(${JSON.stringify(freshShell).replaceAll("</", "<\\/")});
			});
			parent.postMessage({ type: ${JSON.stringify(MCP_APP_SHELL_READY_MESSAGE)} }, "*");
		</script>`;
		try {
			await renderTool({ args: { title: "Chart", html } });

			await waitFor(() => expect(kinds).toContain("settled"), { timeout: 5_000 });
			expect(kinds).toEqual(["delivered", "settled"]);
		} finally {
			window.removeEventListener("message", onMessage);
		}
	});

	it("caps the frame at the requested height", async () => {
		await renderTool({
			args: { title: "Table", height: 300, html: '<div style="height:900px">rows</div>' },
		});

		await waitFor(() => expect(frameHeight("Table")).toBe("300px"));
	});

	it("leaves a shown page to the message inside a settled fold, but keeps a failure there", async () => {
		const { container, unmount } = await renderTool(
			{ args: { title: "Chart", html: "<p>x</p>" } },
			{ inFold: true },
		);
		expect(container.querySelector("iframe")).toBeNull();
		unmount();

		await renderTool(
			{
				args: { title: "Chart", html: "<p>x</p>" },
				status: { type: "incomplete", reason: "error" },
				result: "Tool failed",
			},
			{ inFold: true },
		);
		expect(screen.getByText("Couldn't show Chart")).toBeTruthy();
	});

	it("shows a placeholder while the call runs and an error row when it fails", async () => {
		const { unmount } = await renderTool({
			args: { title: "Chart", html: "<p>x</p>" },
			status: { type: "running" },
		});
		expect(screen.getByLabelText("Rendering page")).toBeTruthy();
		unmount();

		await renderTool({
			args: { title: "Chart", html: "<p>x</p>" },
			status: { type: "incomplete", reason: "error" },
			result: "Tool failed",
		});
		expect(screen.getByText("Couldn't show Chart")).toBeTruthy();
		expect(screen.getByText(/Tool failed/)).toBeTruthy();
	});
});
