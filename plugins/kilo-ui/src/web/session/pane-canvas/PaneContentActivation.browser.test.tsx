import { cleanup, render } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { createLayout, type Arrangement } from "@kilo-desktop/pane-layout";
import { ChatPaneCanvas } from "./ChatPaneCanvas.js";

afterEach(cleanup);

it.each(["tiles", "carousel"] as const)(
	"activates notebook frames on the first interaction and between notebooks in %s",
	async (arrangement) => {
		await page.viewport(1300, 700);
		const select = vi.fn();
		const ran = vi.fn();
		function Harness() {
			useEffect(() => {
				const onMessage = (event: MessageEvent) => {
					if (event.data?.type === "notebook-run") ran(event.data.value);
				};
				window.addEventListener("message", onMessage);
				return () => window.removeEventListener("message", onMessage);
			}, []);
			const [layout, setLayout] = useState(() =>
				createLayout(
					[
						{ id: "agent", kind: "agent", title: "Chat" },
						{ id: "notebook-a", kind: "notebook", title: "Notebook A" },
						{ id: "notebook-b", kind: "notebook", title: "Notebook B" },
					],
					"agent",
				),
			);
			return (
				<div style={{ display: "flex", width: 1250, height: 400 }}>
					<ChatPaneCanvas
						layout={layout}
						arrangement={arrangement}
						definitions={[]}
						onLayoutChange={setLayout}
						onSelectPane={select}
						onLaunch={vi.fn()}
						onLaunchChat={vi.fn()}
						renderPane={(id) =>
							id === "agent" ? (
								<textarea aria-label="Chat editor" />
							) : (
								<iframe
									title={id}
									data-qa-id={`frame-${id}`}
									sandbox="allow-scripts"
									srcDoc={`<button onclick="parent.postMessage({type:'notebook-run',value:document.querySelector('textarea').value}, '*')">Run</button><textarea aria-label="Cell">print(1)</textarea>`}
								/>
							)
						}
					/>
				</div>
			);
		}
		render(<Harness />);
		const firstFrame = page.getByTestId("frame-notebook-a");
		const mountedFrame = firstFrame.element();
		const firstNotebook = page.frameLocator(firstFrame);
		const secondNotebook = page.frameLocator(page.getByTestId("frame-notebook-b"));
		const firstGroup = page.getByTestId("chat-pane-group-group:notebook-a");
		const secondGroup = page.getByTestId("chat-pane-group-group:notebook-b");

		await firstNotebook.getByRole("button", { name: "Run", exact: true }).click();
		await expect.element(firstGroup).toHaveAttribute("data-group-active", "true");
		await vi.waitFor(() => expect(ran).toHaveBeenCalledExactlyOnceWith("print(1)"));
		await firstNotebook.getByRole("textbox", { name: "Cell" }).fill("Unsaved notebook code");
		expect(select).toHaveBeenCalledOnce();

		await secondNotebook.getByRole("textbox", { name: "Cell" }).click();
		await expect.element(secondGroup).toHaveAttribute("data-group-active", "true");
		await expect.element(firstGroup).not.toHaveAttribute("data-group-active");
		expect(select).toHaveBeenLastCalledWith("notebook-b");

		await firstNotebook.getByRole("textbox", { name: "Cell" }).click();
		await expect.element(firstGroup).toHaveAttribute("data-group-active", "true");
		await firstNotebook.getByRole("button", { name: "Run", exact: true }).click();
		await vi.waitFor(() => expect(ran).toHaveBeenLastCalledWith("Unsaved notebook code"));
		expect(firstFrame.element()).toBe(mountedFrame);

		await page.getByRole("textbox", { name: "Chat editor" }).click();
		await expect
			.element(page.getByTestId("chat-pane-group-group:agent"))
			.toHaveAttribute("data-group-active", "true");
	},
);

it.each(["tiles", "carousel"] as const)(
	"activates pane content in %s without swallowing its interaction",
	async (arrangement: Arrangement) => {
		const select = vi.fn();
		const clicked = vi.fn();
		function Harness() {
			const [layout, setLayout] = useState(() =>
				createLayout(
					[
						{ id: "agent", kind: "agent", title: "Chat" },
						{ id: "files", kind: "document", title: "Files" },
					],
					"agent",
				),
			);
			return (
				<div style={{ display: "flex", width: 900, height: 400 }}>
					<ChatPaneCanvas
						layout={layout}
						arrangement={arrangement}
						definitions={[]}
						onLayoutChange={setLayout}
						onSelectPane={select}
						onLaunch={vi.fn()}
						onLaunchChat={vi.fn()}
						renderPane={(id) => (
							<div onPointerDown={(event) => event.stopPropagation()}>
								<textarea aria-label={`${id} editor`} defaultValue="Unsaved work" />
								<button type="button" onClick={clicked}>
									{id} action
								</button>
							</div>
						)}
					/>
				</div>
			);
		}
		const { baseElement } = render(<Harness />);
		const screen = page.elementLocator(baseElement);
		const files = screen.getByTestId("chat-pane-group-group:files");
		const chat = screen.getByTestId("chat-pane-group-group:agent");
		const editor = screen.getByRole("textbox", { name: "files editor" });
		const mountedEditor = editor.element();
		await screen.getByRole("button", { name: "files action" }).click();
		await expect.element(files).toHaveAttribute("data-group-active", "true");
		await expect.element(chat).not.toHaveAttribute("data-group-active");
		expect(clicked).toHaveBeenCalledOnce();
		expect(select).toHaveBeenLastCalledWith("files");
		await editor.click();
		await expect.element(editor).toHaveFocus();
		expect(editor.element()).toBe(mountedEditor);
		expect((mountedEditor as HTMLTextAreaElement).value).toBe("Unsaved work");
		expect(select).toHaveBeenCalledOnce();
		await screen.getByRole("textbox", { name: "agent editor" }).click();
		await expect.element(chat).toHaveAttribute("data-group-active", "true");
		await expect.element(files).not.toHaveAttribute("data-group-active");
		expect(select).toHaveBeenLastCalledWith("agent");
	},
);
