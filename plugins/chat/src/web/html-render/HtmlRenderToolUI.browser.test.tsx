import { Activity, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
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
import { mcpAppShellHtml } from "../../main/html-render/mcp-app-host";
import { renderInKernel } from "../../test/kernel-harness";
import type { ToolCallView } from "../tools/tool-call";
import { ChatMarkdownProvider } from "../thread/chat-markdown";
import { TurnWorkFoldContext } from "../tools/turn-work-fold-context";
import { HtmlRenderFrame } from "./HtmlRenderFrame";
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

function createShellUrl(title = "HTML page"): string {
	const url = URL.createObjectURL(new Blob([mcpAppShellHtml(title)], { type: "text/html" }));
	onTestFinished(() => URL.revokeObjectURL(url));
	return url;
}

/**
 * Portal whose layout effect detaches its host on cleanup (the exact DOM
 * disconnect that happens when an ancestor removes a portal on `<Activity>` hide).
 */
function DetachingPortal({ children }: { readonly children: ReactNode }) {
	const targetRef = useRef<HTMLDivElement>(null);
	const [host] = useState(() => document.createElement("div"));
	useLayoutEffect(() => {
		const target = targetRef.current;
		if (!target) return;
		target.append(host);
		return () => host.remove();
	}, [host]);
	return <div ref={targetRef}>{createPortal(children, host)}</div>;
}

describe("HtmlRenderFrame shell handshake under Activity", () => {
	it("re-delivers the page when its iframe is disconnected and reconnected across an Activity hide/show cycle", async () => {
		const shellUrl = createShellUrl();
		const events: string[] = [];
		const onMessage = (event: MessageEvent) => {
			if (typeof event.data?.kind === "string") events.push(event.data.kind);
		};
		window.addEventListener("message", onMessage);
		onTestFinished(() => window.removeEventListener("message", onMessage));

		const html = `<!doctype html><body><div style="height:260px">Chart</div><script>
			addEventListener("message", (event) => {
				if (event.data && event.data.kind === "ping") parent.postMessage({ kind: "pong" }, "*");
			});
			parent.postMessage({ kind: "rendered" }, "*");
		</script></body>`;

		function Harness() {
			const [shown, setShown] = useState(true);
			return (
				<>
					<button type="button" onClick={() => setShown((value) => !value)}>
						Toggle visibility
					</button>
					<Activity mode={shown ? "visible" : "hidden"}>
						<DetachingPortal>
							<HtmlRenderFrame html={html} title="Chart" fit="content" shellSrc={shellUrl} />
						</DetachingPortal>
					</Activity>
				</>
			);
		}

		await renderInKernel(<Harness />);

		await waitFor(() => expect(events).toEqual(["rendered"]));
		await waitFor(() => expect(frameHeight("Chart")).toBe("260px"));

		fireEvent.click(screen.getByRole("button", { name: "Toggle visibility" }));
		fireEvent.click(screen.getByRole("button", { name: "Toggle visibility" }));

		await waitFor(() => expect(events.filter((kind) => kind === "rendered")).toHaveLength(2));
		const frame = screen.getByTitle("Chart") as HTMLIFrameElement;
		frame.contentWindow?.postMessage({ kind: "ping" }, "*");
		await waitFor(() => expect(events).toContain("pong"));
	});

	it("keeps a connected iframe alive across an Activity hide/show cycle without tripping the shell-ready timeout", async () => {
		const shellUrl = createShellUrl();
		const counts: number[] = [];
		let renders = 0;
		const onMessage = (event: MessageEvent) => {
			if (event.data?.kind === "rendered") renders += 1;
			if (event.data?.kind === "count" && typeof event.data.clicks === "number") {
				counts.push(event.data.clicks);
			}
		};
		window.addEventListener("message", onMessage);
		onTestFinished(() => {
			window.removeEventListener("message", onMessage);
			vi.useRealTimers();
		});

		const html = `<!doctype html><body><div style="height:240px">Interactive</div><script>
			var clicks = 0;
			addEventListener("message", (event) => {
				if (event.data && event.data.kind === "increment") {
					clicks += 1;
					parent.postMessage({ kind: "count", clicks: clicks }, "*");
				}
			});
			parent.postMessage({ kind: "rendered" }, "*");
		</script></body>`;

		function Harness() {
			const [shown, setShown] = useState(true);
			return (
				<>
					<button type="button" onClick={() => setShown((value) => !value)}>
						Toggle visibility
					</button>
					<Activity mode={shown ? "visible" : "hidden"}>
						<HtmlRenderFrame html={html} title="Chart" fit="content" shellSrc={shellUrl} />
					</Activity>
				</>
			);
		}

		await renderInKernel(<Harness />);
		await waitFor(() => expect(renders).toBe(1));

		const frame = screen.getByTitle("Chart") as HTMLIFrameElement;
		frame.contentWindow?.postMessage({ kind: "increment" }, "*");
		await waitFor(() => expect(counts).toEqual([1]));

		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		fireEvent.click(screen.getByRole("button", { name: "Toggle visibility" }));
		fireEvent.click(screen.getByRole("button", { name: "Toggle visibility" }));
		act(() => {
			vi.advanceTimersByTime(15_000);
		});
		vi.useRealTimers();

		expect(screen.queryByText("This page failed to load.")).toBeNull();
		expect(renders).toBe(1);
		expect(screen.getByTitle("Chart")).toBe(frame);

		frame.contentWindow?.postMessage({ kind: "increment" }, "*");
		await waitFor(() => expect(counts).toEqual([1, 2]));
	});

	it("never smuggles HTML into a foreign shell after in-frame navigation and an Activity hide/show cycle", async () => {
		const shellUrl = createShellUrl();
		const events: string[] = [];
		const onMessage = (event: MessageEvent) => {
			if (typeof event.data?.kind === "string") events.push(event.data.kind);
		};
		window.addEventListener("message", onMessage);
		onTestFinished(() => window.removeEventListener("message", onMessage));

		// A foreign shell (e.g. /widget-host.html under a looser CSP) that reports
		// if HTML is ever delivered to it and can re-announce READY on demand.
		const foreignShell = `<!doctype html><body><script>
			addEventListener("message", (event) => {
				if (event.data && event.data.type === ${JSON.stringify(MCP_APP_SHELL_HTML_MESSAGE)}) {
					parent.postMessage({ kind: "smuggled" }, "*");
				}
				if (event.data && event.data.kind === "probe-ready") {
					parent.postMessage({ type: ${JSON.stringify(MCP_APP_SHELL_READY_MESSAGE)} }, "*");
					parent.postMessage({ kind: "probe-sent" }, "*");
				}
				if (event.data && event.data.kind === "ping") {
					parent.postMessage({ kind: "pong" }, "*");
				}
			});
			parent.postMessage({ type: ${JSON.stringify(MCP_APP_SHELL_READY_MESSAGE)} }, "*");
			parent.postMessage({ kind: "foreign-loaded" }, "*");
		</script></body>`;
		const html = `<!doctype html><body><script>
			parent.postMessage({ kind: "delivered" }, "*");
			location.href = "data:text/html," + encodeURIComponent(${JSON.stringify(foreignShell).replaceAll("</", "<\\/")});
		</script></body>`;

		function Harness({ detach }: { readonly detach: boolean }) {
			const [shown, setShown] = useState(true);
			const content = (
				<HtmlRenderFrame html={html} title="Chart" fit="content" shellSrc={shellUrl} />
			);
			return (
				<>
					<button type="button" onClick={() => setShown((value) => !value)}>
						Toggle visibility
					</button>
					<Activity mode={shown ? "visible" : "hidden"}>
						{detach ? <DetachingPortal>{content}</DetachingPortal> : content}
					</Activity>
				</>
			);
		}

		// Case 1: iframe stays connected across Activity hide/show after navigating
		// to the foreign shell — re-announcing READY after resume must still be ignored.
		const connected = await renderInKernel(<Harness detach={false} />);
		await waitFor(() => expect(events).toEqual(["delivered", "foreign-loaded"]));

		fireEvent.click(screen.getByRole("button", { name: "Toggle visibility" }));
		fireEvent.click(screen.getByRole("button", { name: "Toggle visibility" }));

		const connectedFrame = screen.getByTitle("Chart") as HTMLIFrameElement;
		connectedFrame.contentWindow?.postMessage({ kind: "probe-ready" }, "*");
		// Wait until the host has received the foreign shell's READY (ordered before
		// "probe-sent"), then ping the frame so any wrongly posted HTML would be
		// processed by the foreign shell before it replies "pong".
		await waitFor(() => expect(events).toContain("probe-sent"));
		connectedFrame.contentWindow?.postMessage({ kind: "ping" }, "*");
		await waitFor(() => expect(events).toContain("pong"));
		expect(events).not.toContain("smuggled");
		connected.view.unmount();

		// Case 2: iframe is disconnected and reconnected across Activity hide/show —
		// HtmlRenderFrame remounts a fresh iframe at shellSrc, never delivering to
		// the foreign shell.
		events.length = 0;
		await renderInKernel(<Harness detach={true} />);
		await waitFor(() => expect(events).toEqual(["delivered", "foreign-loaded"]));

		fireEvent.click(screen.getByRole("button", { name: "Toggle visibility" }));
		fireEvent.click(screen.getByRole("button", { name: "Toggle visibility" }));

		await waitFor(() => expect(events.filter((kind) => kind === "foreign-loaded")).toHaveLength(2));
		const remountedFrame = screen.getByTitle("Chart") as HTMLIFrameElement;
		remountedFrame.contentWindow?.postMessage({ kind: "ping" }, "*");
		await waitFor(() => expect(events).toContain("pong"));
		expect(events).not.toContain("smuggled");
	});
});
