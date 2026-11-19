import { cleanup, fireEvent, render } from "@testing-library/react";
import { TerminalIcon } from "lucide-react";
import { StrictMode, useLayoutEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	addPane,
	createLayout,
	movePane,
	movePaneToGroup,
	removePane,
	setActivePane,
	togglePin,
} from "@kilo-desktop/pane-layout";

import { PaneCanvas } from "./PaneCanvas";
import { startPaneDrag } from "./test-helpers";
import type { CanvasPaneKind } from "../shared/pane-kinds";

const terminalKind: CanvasPaneKind = {
	id: "kilo.terminal/terminal",
	title: "Terminal",
	Icon: TerminalIcon,
	addable: true,
	keepAlive: true,
};

function ShadowFolderTree() {
	const hostRef = useRef<HTMLDivElement>(null);
	const [expanded, setExpanded] = useState(false);

	useLayoutEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
		root.innerHTML = `<button type="button" role="treeitem" data-type="item" data-item-type="folder" aria-expanded="${expanded ? "true" : "false"}">src</button>`;
		const button = root.querySelector("button");
		const onClick = () => setExpanded((current) => !current);
		button?.addEventListener("click", onClick);
		return () => button?.removeEventListener("click", onClick);
	}, [expanded]);

	return (
		<div ref={hostRef} data-expanded={expanded ? "true" : "false"} data-qa-id="files-shadow-tree" />
	);
}

afterEach(() => {
	cleanup();
});

describe("PaneCanvas", () => {
	it("shows the active tab state for a lone pane", () => {
		const layout = createLayout([{ id: "agent", kind: "agent", title: "Chat" }], "agent");
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					renderPane={(paneId) => <div>{paneId}</div>}
				/>
			</div>,
		);
		const tab = baseElement.querySelector("[data-pane-tab='agent']");
		const frame = baseElement.querySelector("[data-qa-id='chat-pane-frame']");

		expect(tab).toHaveAttribute("data-active", "true");
		expect(frame).toHaveAttribute("data-pane-active", "true");
	});

	it("marks the focused island only when another island is visible", async () => {
		const renderCanvas = (layout: ReturnType<typeof createLayout>) =>
			render(
				<div style={{ display: "flex", width: 900, height: 400 }}>
					<PaneCanvas
						arrangement="tiles"
						kinds={[]}
						layout={layout}
						onLaunch={vi.fn()}
						onLayoutChange={vi.fn()}
						onSelectPane={vi.fn()}
						renderPane={(paneId) => <div>{paneId}</div>}
					/>
				</div>,
			).baseElement;
		const activeIslands = (root: HTMLElement) =>
			root.querySelectorAll("[data-qa-id='chat-pane-island'][data-active]").length;

		expect(
			activeIslands(
				renderCanvas(createLayout([{ id: "agent", kind: "agent", title: "Chat" }], "agent")),
			),
		).toBe(0);
		cleanup();

		const split = createLayout(
			[
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "agent-2", kind: "agent", title: "Chat 2" },
			],
			"agent",
		);
		const root = renderCanvas(split);
		expect(activeIslands(root)).toBe(1);

		await page
			.elementLocator(root)
			.getByRole("button", { name: "Expand Chat", exact: true })
			.click();
		expect(activeIslands(root)).toBe(0);
	});

	it("lets the active tab close action receive clicks through a long title", async () => {
		const onClosePane = vi.fn();
		const layout = createLayout(
			[
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "terminal", kind: "tool", title: "Terminal 1 with a very long title" },
			],
			"terminal",
		);
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					onClosePane={onClosePane}
					renderPane={(paneId) => <div>{paneId}</div>}
				/>
			</div>,
		);
		const screen = page.elementLocator(baseElement);
		const close = screen.getByTestId("chat-pane-close-tab-terminal");
		await expect.element(close).toBeVisible();
		await close.click();
		expect(onClosePane).toHaveBeenCalledWith("terminal");
	});

	it("offers focus and dock actions in place of popped-out pane content", async () => {
		const layout = createLayout([{ id: "files", kind: "document", title: "Files" }], "files");
		const focus = vi.fn();
		const dock = vi.fn();
		const renderPane = vi.fn(() => <div>Files content</div>);
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					poppedOutPaneIds={new Set(["files"])}
					onFocusPoppedOutPane={focus}
					onDockPoppedOutPane={dock}
					renderPane={renderPane}
				/>
			</div>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("This view is open in a separate window.")).toBeVisible();
		await screen.getByRole("button", { name: "Bring to front" }).click();
		await screen.getByRole("button", { name: "Dock" }).click();

		expect(focus).toHaveBeenCalledOnce();
		expect(focus).toHaveBeenCalledWith("files");
		expect(dock).toHaveBeenCalledOnce();
		expect(dock).toHaveBeenCalledWith("files");
		expect(renderPane).not.toHaveBeenCalled();
	});

	it("shows the popped-out empty state when its tab is selected beside a docked tab", async () => {
		const focus = vi.fn();
		const initial = movePaneToGroup(
			createLayout(
				[
					{ id: "agent", kind: "agent", title: "Chat" },
					{ id: "files", kind: "document", title: "Files" },
				],
				"agent",
			),
			"files",
			"agent",
			1,
		);

		function SelectedPoppedOutPane() {
			const [layout, setLayout] = useState(initial);
			return (
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={setLayout}
					onSelectPane={vi.fn()}
					poppedOutPaneIds={new Set(["files"])}
					onFocusPoppedOutPane={focus}
					onDockPoppedOutPane={vi.fn()}
					renderPane={(paneId) => <div>{paneId} content</div>}
				/>
			);
		}

		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<SelectedPoppedOutPane />
			</div>,
		);
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("chat-pane-tab-files").click();

		await expect
			.element(screen.getByTestId("chat-pane-popped-out-files"))
			.toHaveAttribute("data-slot", "empty");
		await expect.element(screen.getByText("This view is open in a separate window.")).toBeVisible();
		expect(baseElement.querySelector("[data-qa-id='chat-pane-content-files']")).toBeNull();
		expect(focus).not.toHaveBeenCalled();
	});

	it("renders a local tab strip per group and keeps inactive grouped panes mounted", async () => {
		const initial = createLayout(
			[
				{
					id: "agent",
					kind: "agent",
					title: "Chat",
				},
				{
					id: "files",
					kind: "document",
					title: "Files",
				},
				{
					id: "output",
					kind: "tool",
					title: "Output",
				},
			],
			"agent",
		);
		const grouped = setActivePane(
			movePaneToGroup(initial, "files", initial.groups[0]!.id),
			"agent",
		);

		function StatefulPane({ paneId }: { paneId: string }) {
			const [count, setCount] = useState(0);
			return (
				<button type="button" onClick={() => setCount((current) => current + 1)}>
					{paneId}:{count}
				</button>
			);
		}

		function Harness() {
			const [layout, setLayout] = useState(grouped);
			return (
				<div style={{ display: "flex", width: 900, height: 400 }}>
					<PaneCanvas
						arrangement="tiles"
						kinds={[]}
						layout={layout}
						onLaunch={vi.fn()}
						onLayoutChange={setLayout}
						onSelectPane={(paneId) => setLayout((current) => setActivePane(current, paneId))}
						onClosePane={vi.fn()}
						onPopOutPane={vi.fn()}
						renderPane={(paneId) => <StatefulPane paneId={paneId} />}
					/>
				</div>
			);
		}

		const { baseElement } = render(<Harness />);
		const screen = page.elementLocator(baseElement);
		const groupedHook = `chat-pane-group-${grouped.groups[0]!.id}`;
		const group = baseElement.querySelector(`[data-qa-id='${groupedHook}']`);
		const tabBounds = () =>
			[...group!.querySelectorAll<HTMLElement>("[data-pane-tab]")].map((tab) => {
				const { offsetLeft: x, offsetWidth: width } = tab;
				return { x, width };
			});
		const initialTabBounds = tabBounds();

		expect(baseElement.querySelectorAll("[data-qa-id='chat-pane-tabs']")).toHaveLength(2);
		expect(group?.querySelectorAll("[role='tab']")).toHaveLength(2);
		expect(baseElement.querySelectorAll("[data-pane-tab][data-active='true']")).toHaveLength(1);
		expect(baseElement.querySelectorAll("[data-qa-id='chat-pane-parked-files']")).toHaveLength(1);
		expect(baseElement.querySelector("[data-qa-id='chat-pane-parked-files']")).not.toBeVisible();
		const strip = group?.querySelector<HTMLElement>("[data-qa-id='chat-pane-tabs']");
		const pane = group?.querySelector<HTMLElement>("[data-qa-id='chat-pane-agent']");
		const island = group?.querySelector<HTMLElement>("[data-qa-id='chat-pane-island']");
		expect(strip?.getBoundingClientRect().height).toBe(40);
		expect(island?.contains(strip ?? null)).toBe(true);
		expect(island?.contains(pane ?? null)).toBe(true);
		expect(pane?.getBoundingClientRect().top).toBe(strip?.getBoundingClientRect().bottom);

		const outputGroup = grouped.groups.find((candidate) =>
			candidate.tabs.some((tab) => tab.id === "output"),
		);
		const outputStrip = baseElement.querySelector<HTMLElement>(
			`[data-pane-group-tabs='${outputGroup?.id}']`,
		);
		expect(outputStrip).toBeTruthy();
		fireEvent.click(outputStrip!);
		await expect
			.element(screen.getByTestId("chat-pane-tab-output"))
			.toHaveAttribute("aria-selected", "true");

		await screen.getByTestId("chat-pane-tab-files").click();
		expect(tabBounds()).toEqual(initialTabBounds);
		await screen.getByRole("button", { name: "files:0" }).click();
		await screen.getByTestId("chat-pane-tab-agent").click();
		expect(tabBounds()).toEqual(initialTabBounds);
		await userEvent.keyboard("{ArrowRight}");
		await expect.element(screen.getByTestId("chat-pane-tab-files")).toHaveFocus();
		await expect
			.element(screen.getByTestId("chat-pane-tab-agent"))
			.toHaveAttribute("aria-selected", "true");
		await userEvent.keyboard("{Enter}");

		await expect.element(screen.getByRole("button", { name: "files:1" })).toBeVisible();
		await expect.element(screen.getByRole("tabpanel", { name: "Files" })).toBeVisible();
		expect(tabBounds()).toEqual(initialTabBounds);
	});

	it("spans the vertical column splitter across the tab group header", () => {
		const layout = createLayout(
			[
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "files", kind: "document", title: "Files" },
			],
			"agent",
		);
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					renderPane={(paneId) => <div>{paneId}</div>}
				/>
			</div>,
		);
		const column = baseElement.querySelector<HTMLElement>(
			`[data-column-id='${layout.groups[0]!.id}']`,
		);
		const group = baseElement.querySelector<HTMLElement>(
			`[data-qa-id='chat-pane-group-${layout.groups[0]!.id}']`,
		);
		const pills = group?.querySelector<HTMLElement>("[data-qa-id='chat-pane-tabs']");
		const pane = group?.querySelector<HTMLElement>("[data-qa-id='chat-pane-agent']");
		const handle = column?.querySelector<HTMLElement>(":scope > [data-qa-id='chat-pane-resize']");
		const expand = group?.querySelector("[data-qa-id='chat-pane-expand-agent']");
		const columnBox = column?.getBoundingClientRect();
		const groupBox = group?.getBoundingClientRect();
		const pillBox = pills?.getBoundingClientRect();
		const handleBox = handle?.getBoundingClientRect();

		expect(column && group && pills && handle).toBeTruthy();
		expect(pills?.contains(expand ?? null)).toBe(true);
		expect(pane?.querySelector("[data-qa-id='chat-pane-header']")).toBeNull();
		expect(group?.querySelector("[data-qa-id='chat-pane-resize']")).toBeNull();
		if (!columnBox || !groupBox || !pillBox || !handleBox) return;
		expect(handleBox.top).toBeLessThanOrEqual(pillBox.top + 1);
		expect(handleBox.top).toBeLessThanOrEqual(groupBox.top + 1);
		expect(handleBox.bottom).toBeGreaterThanOrEqual(groupBox.bottom - 1);
		expect(handleBox.height).toBeGreaterThanOrEqual(columnBox.height - 2);
	});

	it("expands a pane to fill the canvas in carousel", async () => {
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
					<PaneCanvas
						arrangement="carousel"
						kinds={[]}
						layout={layout}
						onLaunch={vi.fn()}
						onLayoutChange={setLayout}
						onSelectPane={(paneId) => setLayout((current) => setActivePane(current, paneId))}
						renderPane={(paneId) => <div>{paneId}</div>}
					/>
				</div>
			);
		}

		const { baseElement } = render(<Harness />);
		const screen = page.elementLocator(baseElement);
		const expand = screen.getByTestId("chat-pane-expand-files");

		await screen.getByTestId("chat-pane-tab-files").click({ force: true });
		await expect
			.element(screen.getByTestId("chat-pane-tab-files"))
			.toHaveAttribute("aria-selected", "true");
		await expect.element(expand).toBeVisible();
		await expand.click({ force: true });
		await expect
			.element(screen.getByTestId("kilo-chat-pane-canvas"))
			.toHaveAttribute("data-expanded", "true");
		await expect.element(screen.getByTestId("chat-pane-agent")).not.toBeVisible();
	});

	it.each(["tiles", "carousel"] as const)(
		"follows newly opened and selected panes while maximized in %s",
		async (arrangement) => {
			await page.viewport(1000, 600);
			function Harness() {
				const [layout, setLayout] = useState(() => {
					const initial = createLayout(
						[
							{ id: "agent", kind: "agent", title: "Chat" },
							{ id: "files", kind: "document", title: "Files" },
						],
						"files",
					);
					return arrangement === "carousel" ? togglePin(initial, "group:files") : initial;
				});
				return (
					<>
						<button onClick={() => setLayout((current) => setActivePane(current, "agent"))}>
							Select Chat
						</button>
						<div style={{ display: "flex", width: 900, height: 500 }}>
							<PaneCanvas
								arrangement={arrangement}
								kinds={[]}
								layout={layout}
								onLaunch={vi.fn()}
								onLayoutChange={setLayout}
								onSelectPane={vi.fn()}
								renderPane={(id) =>
									id === "files" ? (
										<button
											onClick={() =>
												setLayout((current) =>
													addPane(current, {
														id: "opened-file",
														kind: "document",
														title: "Opened file",
													}),
												)
											}
										>
											Open file
										</button>
									) : (
										<div>{id}</div>
									)
								}
							/>
						</div>
					</>
				);
			}
			const { baseElement } = render(<Harness />);
			const screen = page.elementLocator(baseElement);
			const canvas = screen.getByTestId("kilo-chat-pane-canvas");
			await screen.getByTestId("chat-pane-tab-files").hover();
			await screen.getByTestId("chat-pane-expand-files").click();
			await expect.element(canvas).toHaveAttribute("data-expanded", "true");
			await screen.getByRole("button", { name: "Open file", exact: true }).click();
			await expect.element(screen.getByTestId("chat-pane-content-opened-file")).toBeVisible();
			await expect.element(screen.getByTestId("chat-pane-files")).not.toBeVisible();
			await expect.element(canvas).toHaveAttribute("data-expanded", "true");
			expect(
				screen.getByTestId("chat-pane-content-opened-file").element().getBoundingClientRect().width,
			).toBeGreaterThan(890);
			await screen.getByRole("button", { name: "Select Chat", exact: true }).click();
			await expect.element(screen.getByTestId("chat-pane-content-agent")).toBeVisible();
			await expect.element(screen.getByTestId("chat-pane-opened-file")).not.toBeVisible();
			await expect.element(canvas).toHaveAttribute("data-expanded", "true");
			await screen.getByTestId("chat-pane-tab-agent").hover();
			await screen.getByTestId("chat-pane-expand-agent").click();
			await expect.element(canvas).toHaveAttribute("data-expanded", "false");
			await expect.element(screen.getByTestId("chat-pane-files")).toBeVisible();
		},
	);
	it.each(["files", "output"] as const)(
		"expands the %s pane of a stacked column to the full canvas height",
		async (paneId) => {
			function Harness() {
				const [layout, setLayout] = useState(() => {
					const initial = createLayout(
						[
							{ id: "agent", kind: "agent", title: "Chat" },
							{ id: "files", kind: "document", title: "Files" },
							{ id: "output", kind: "tool", title: "Output" },
						],
						"agent",
					);
					return movePane(initial, "output", "group:files", "below");
				});
				return (
					<div style={{ display: "flex", width: 900, height: 400 }}>
						<PaneCanvas
							arrangement="tiles"
							kinds={[]}
							layout={layout}
							onLaunch={vi.fn()}
							onLayoutChange={setLayout}
							onSelectPane={(id) => setLayout((current) => setActivePane(current, id))}
							renderPane={(id) => <div>{id}</div>}
						/>
					</div>
				);
			}
			const { baseElement } = render(<Harness />);
			const screen = page.elementLocator(baseElement);
			const canvas = screen.getByTestId("kilo-chat-pane-canvas");
			const group = screen.getByTestId(`chat-pane-group-group:${paneId}`);
			const collapsedHeight = group.element().getBoundingClientRect().height;
			expect(collapsedHeight).toBeLessThan(250);

			await screen.getByTestId(`chat-pane-tab-${paneId}`).hover();
			await screen.getByTestId(`chat-pane-expand-${paneId}`).click();
			await expect.element(canvas).toHaveAttribute("data-expanded", "true");

			const canvasBox = canvas.element().getBoundingClientRect();
			const groupBox = group.element().getBoundingClientRect();
			expect(groupBox.width).toBeGreaterThan(canvasBox.width - 2);
			expect(groupBox.height).toBeGreaterThan(canvasBox.height - 2);
		},
	);

	it("spans the vertical column splitter across a stacked column", () => {
		const initial = createLayout(
			[
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "files", kind: "document", title: "Files" },
				{ id: "output", kind: "tool", title: "Output" },
			],
			"agent",
		);
		const stacked = movePane(initial, "files", initial.groups[0]!.id, "below");
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={stacked}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					renderPane={(paneId) => <div>{paneId}</div>}
				/>
			</div>,
		);
		const column = baseElement.querySelector<HTMLElement>(
			`[data-column-id='${stacked.groups[0]!.stackId}']`,
		);
		const firstGroup = column?.querySelector<HTMLElement>(
			`[data-qa-id='chat-pane-group-${stacked.groups[0]!.id}']`,
		);
		const lastGroup = column?.querySelector<HTMLElement>(
			`[data-qa-id='chat-pane-group-${stacked.groups[1]!.id}']`,
		);
		const handle = column?.querySelector<HTMLElement>(":scope > [data-qa-id='chat-pane-resize']");
		const columnBox = column?.getBoundingClientRect();
		const firstBox = firstGroup?.getBoundingClientRect();
		const lastBox = lastGroup?.getBoundingClientRect();
		const handleBox = handle?.getBoundingClientRect();

		expect(column && firstGroup && lastGroup && handle).toBeTruthy();
		expect(column?.querySelectorAll("[data-qa-id='chat-pane-resize']")).toHaveLength(1);
		expect(firstGroup?.querySelector("[data-qa-id='chat-pane-resize']")).toBeNull();
		expect(lastGroup?.querySelector("[data-qa-id='chat-pane-resize']")).toBeNull();
		if (!columnBox || !firstBox || !lastBox || !handleBox) return;
		expect(handleBox.top).toBeLessThanOrEqual(firstBox.top + 1);
		expect(handleBox.bottom).toBeGreaterThanOrEqual(lastBox.bottom - 1);
		expect(handleBox.height).toBeGreaterThanOrEqual(columnBox.height - 2);
	});

	it("spans the splitter beside a stacked neighbor across the full stack height", () => {
		const initial = createLayout(
			[
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "files", kind: "document", title: "Files" },
				{ id: "output", kind: "tool", title: "Output" },
			],
			"agent",
		);
		const outputGroup = initial.groups.find((group) =>
			group.tabs.some((tab) => tab.id === "output"),
		);
		const stacked = movePane(initial, "files", outputGroup!.id, "below");
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={stacked}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					renderPane={(paneId) => <div>{paneId}</div>}
				/>
			</div>,
		);
		const agentGroup = stacked.groups.find((group) => group.tabs.some((tab) => tab.id === "agent"));
		const stackGroup = stacked.groups.find((group) => group.stackId);
		const column = baseElement.querySelector<HTMLElement>(`[data-column-id='${agentGroup!.id}']`);
		const stack = baseElement.querySelector<HTMLElement>(
			`[data-column-id='${stackGroup!.stackId}']`,
		);
		const handle = column?.querySelector<HTMLElement>(":scope > [data-qa-id='chat-pane-resize']");
		const stackBox = stack?.getBoundingClientRect();
		const handleBox = handle?.getBoundingClientRect();

		expect(column && stack && handle).toBeTruthy();
		expect(
			column?.querySelector("[data-qa-id='chat-pane-agent'] [data-qa-id='chat-pane-resize']"),
		).toBeNull();
		if (!stackBox || !handleBox) return;
		expect(handleBox.top).toBeLessThanOrEqual(stackBox.top + 1);
		expect(handleBox.bottom).toBeGreaterThanOrEqual(stackBox.bottom - 1);
		expect(handleBox.height).toBeGreaterThanOrEqual(stackBox.height - 2);
	});

	it("moves a pointer-dragged tab into another local group", () => {
		function Harness() {
			const [layout, setLayout] = useState(() =>
				createLayout([
					{ id: "agent", kind: "agent", title: "Chat" },
					{ id: "files", kind: "document", title: "Files" },
				]),
			);
			return (
				<div style={{ display: "flex", width: 900, height: 400 }}>
					<PaneCanvas
						arrangement="tiles"
						kinds={[]}
						layout={layout}
						onLaunch={vi.fn()}
						onLayoutChange={setLayout}
						onSelectPane={vi.fn()}
						renderPane={(paneId) => <div>{paneId}</div>}
					/>
				</div>
			);
		}

		const { baseElement } = render(<Harness />);
		const source = baseElement.querySelector<HTMLElement>("[data-qa-id='chat-pane-tab-files']");
		const target = baseElement.querySelector<HTMLElement>("[data-pane-tab='agent']");
		expect(source).toBeTruthy();
		expect(target).toBeTruthy();
		if (!source || !target) return;

		const sourceBox = source.getBoundingClientRect();
		const targetBox = target.getBoundingClientRect();
		const targetX = targetBox.right - 1;
		source.setPointerCapture = vi.fn();
		source.hasPointerCapture = vi.fn(() => false);
		const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
		fireEvent.pointerDown(source, {
			button: 0,
			pointerId: 7,
			clientX: sourceBox.left + 8,
			clientY: sourceBox.top + 8,
		});
		fireEvent.pointerMove(source, {
			pointerId: 7,
			clientX: targetX,
			clientY: targetBox.top + 8,
		});
		fireEvent.pointerUp(source, {
			pointerId: 7,
			clientX: targetX,
			clientY: targetBox.top + 8,
		});
		hit.mockRestore();

		expect(baseElement.querySelectorAll("[data-qa-id='chat-pane-tabs']")).toHaveLength(1);
		expect(
			[...baseElement.querySelectorAll("[data-pane-tab]")].map(
				(tab) => (tab as HTMLElement).dataset.paneTab,
			),
		).toEqual(["agent", "files"]);
	});

	it.each(["before", "after", "above", "below", "inside"] as const)(
		"previews a %s drop without committing or remounting the pane, and cancels with Escape",
		async (position) => {
			await page.viewport(1100, 700);
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			const initial = createLayout([
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "files", kind: "document", title: "Files" },
				{ id: "other", kind: "document", title: "Other" },
			]);
			const layout = movePaneToGroup(initial, "other", "group:files");
			const commit = vi.fn();
			const { baseElement } = render(
				<div style={{ display: "flex", width: 900, height: 400 }}>
					<PaneCanvas
						arrangement="tiles"
						kinds={[]}
						layout={layout}
						onLaunch={vi.fn()}
						onLayoutChange={commit}
						onSelectPane={vi.fn()}
						renderPane={(id) => <textarea aria-label={id} defaultValue="Unsaved work" />}
					/>
				</div>,
			);
			const source = baseElement.querySelector<HTMLElement>("[data-qa-id='chat-pane-tab-files']")!;
			const target = baseElement.querySelector<HTMLElement>("[data-pane-group-id='group:agent']")!;
			const content = target.querySelector<HTMLElement>("[data-qa-id='chat-pane-frame']")!;
			const editor = content.querySelector("textarea")!;
			const before = content.getBoundingClientRect();
			const rect = target.getBoundingClientRect();
			const row = target
				.querySelector<HTMLElement>("[data-pane-group-tabs]")!
				.getBoundingClientRect();
			const x =
				position === "before"
					? rect.left + 2
					: position === "after"
						? rect.right - 2
						: rect.left + rect.width / 2;
			const y =
				position === "above"
					? (rect.top + row.top) / 2
					: position === "below"
						? rect.bottom - 2
						: rect.top + rect.height / 2;
			source.setPointerCapture = vi.fn();
			source.hasPointerCapture = vi.fn(() => false);
			fireEvent.pointerDown(source, {
				button: 0,
				pointerId: 42,
				clientX: source.getBoundingClientRect().left + 8,
				clientY: 12,
			});
			fireEvent.pointerMove(source, { pointerId: 42, clientX: x, clientY: y });
			expect(target).toHaveAttribute("data-drop-zone", position);
			expect(document.querySelector("[data-qa-id='chat-pane-drag-preview']")).toHaveTextContent(
				"Files",
			);
			expect(target.querySelector("[data-qa-id='chat-pane-drop-preview']")?.textContent).toContain(
				position === "inside" ? "Add to tab group" : "Split here",
			);
			if (position !== "inside") {
				await vi.waitFor(() => {
					const preview = content.getBoundingClientRect();
					if (position === "before" || position === "after")
						expect(preview.width).toBeLessThan(before.width * 0.7);
					else expect(preview.height).toBeLessThan(before.height * 0.7);
				});
			}
			expect(commit).not.toHaveBeenCalled();
			expect(content.querySelector("textarea")).toBe(editor);
			fireEvent.keyDown(window, { key: "Escape" });
			fireEvent.pointerUp(source, { pointerId: 42, clientX: x, clientY: y });
			expect(commit).not.toHaveBeenCalled();
			expect(document.querySelector("[data-qa-id='chat-pane-drag-preview']")).toBeNull();
			expect(target.querySelector("[data-qa-id='chat-pane-drop-preview']")).toBeNull();
			expect(target).not.toHaveAttribute("data-drop-zone");
			expect(editor.value).toBe("Unsaved work");
			await vi.waitFor(() =>
				expect(content.getBoundingClientRect().width).toBeCloseTo(before.width, 0),
			);
		},
	);

	it("moves every tab in a group when its tab-row space is dragged", () => {
		const initial = createLayout([
			{ id: "agent", kind: "agent", title: "Chat" },
			{ id: "files", kind: "document", title: "Files" },
			{ id: "output", kind: "tool", title: "Output" },
		]);
		const grouped = movePaneToGroup(initial, "files", initial.groups[0]!.id);
		const sourceId = grouped.groups[0]!.id;
		const targetId = grouped.groups[1]!.id;

		function Harness() {
			const [layout, setLayout] = useState(grouped);
			return (
				<div style={{ display: "flex", width: 900, height: 400 }}>
					<PaneCanvas
						arrangement="tiles"
						kinds={[]}
						layout={layout}
						onLaunch={vi.fn()}
						onLayoutChange={setLayout}
						onSelectPane={vi.fn()}
						renderPane={(paneId) => <div>{paneId}</div>}
					/>
				</div>
			);
		}

		const { baseElement } = render(<Harness />);
		const source = baseElement.querySelector<HTMLElement>(
			`[data-qa-id='chat-pane-group-drag-${sourceId}']`,
		);
		const target = baseElement.querySelector<HTMLElement>(`[data-pane-group-id='${targetId}']`);
		expect(source).toBeTruthy();
		expect(target).toBeTruthy();
		if (!source || !target) return;

		const sourceBox = source.getBoundingClientRect();
		const targetBox = target.getBoundingClientRect();
		const targetX = targetBox.right - 1;
		source.setPointerCapture = vi.fn();
		source.hasPointerCapture = vi.fn(() => false);
		const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
		fireEvent.pointerDown(source, {
			button: 0,
			pointerId: 8,
			clientX: sourceBox.left + 8,
			clientY: sourceBox.top + 8,
		});
		fireEvent.pointerMove(source, {
			pointerId: 8,
			clientX: targetX,
			clientY: targetBox.top + 8,
		});
		fireEvent.pointerUp(source, {
			pointerId: 8,
			clientX: targetX,
			clientY: targetBox.top + 8,
		});
		hit.mockRestore();

		expect(
			[...baseElement.querySelectorAll("[data-pane-group-id]")].map((group) =>
				[...group.querySelectorAll("[data-pane-tab]")].map(
					(tab) => (tab as HTMLElement).dataset.paneTab,
				),
			),
		).toEqual([["output"], ["agent", "files"]]);
	});

	it("expands a file-tree folder rendered in shadow DOM", async () => {
		const layout = createLayout(
			[
				{
					id: "agent",
					kind: "agent",
					title: "Chat",
				},
				{
					id: "files",
					kind: "document",
					title: "Files",
				},
			],
			"files",
		);
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<PaneCanvas
					arrangement="carousel"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					renderPane={(paneId) => (paneId === "files" ? <ShadowFolderTree /> : <div>Chat</div>)}
				/>
			</div>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("chat-pane-carousel-track")).toBeVisible();
		await screen.getByRole("treeitem", { name: "src" }).click();

		expect(baseElement.querySelector("[data-qa-id='files-shadow-tree']")).toHaveAttribute(
			"data-expanded",
			"true",
		);
	});

	it("preserves draft and iframe content when pinning and unpinning a stacked column", async () => {
		await page.viewport(1000, 600);
		const frameLoaded = vi.fn();
		function Draft() {
			const [value, setValue] = useState("");
			return (
				<input
					autoFocus
					aria-label="Draft"
					value={value}
					onChange={(event) => setValue(event.target.value)}
				/>
			);
		}
		function Harness() {
			const [layout, setLayout] = useState(() => {
				const initial = createLayout(
					[
						{ id: "agent", kind: "agent", title: "Chat" },
						{ id: "notebook", kind: "notebook", title: "Notebook" },
					],
					"agent",
				);
				return movePane(initial, "notebook", "group:agent", "below");
			});
			return (
				<div style={{ display: "flex", width: 900, height: 500 }}>
					<PaneCanvas
						arrangement="carousel"
						kinds={[]}
						layout={layout}
						onLaunch={vi.fn()}
						onLayoutChange={setLayout}
						onSelectPane={vi.fn()}
						renderPane={(id) =>
							id === "agent" ? (
								<Draft />
							) : (
								<iframe
									title="Notebook content"
									srcDoc='<input aria-label="Cell" value="Initial">'
									onLoad={frameLoaded}
								/>
							)
						}
					/>
				</div>
			);
		}
		const { baseElement } = render(
			<StrictMode>
				<Harness />
			</StrictMode>,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByRole("textbox", { name: "Draft" })).toHaveFocus();
		await screen.getByRole("textbox", { name: "Draft" }).fill("Keep this draft");
		await vi.waitFor(() => expect(frameLoaded).toHaveBeenCalledTimes(1));
		const frame = baseElement.querySelector("iframe")!;
		const frameDocument = frame.contentDocument!;
		frameDocument.querySelector("input")!.value = "Unsaved cell";
		for (const label of ["Pin column", "Unpin column", "Pin column", "Unpin column"]) {
			await screen.getByTestId("chat-pane-tab-agent").hover();
			await screen.getByRole("button", { name: label, exact: true }).click();
			await expect
				.element(screen.getByRole("textbox", { name: "Draft" }))
				.toHaveValue("Keep this draft");
			expect(baseElement.querySelector("iframe")).toBe(frame);
			expect(frame.contentDocument).toBe(frameDocument);
			expect(frameDocument.querySelector("input")).toHaveValue("Unsaved cell");
			expect(frameLoaded).toHaveBeenCalledTimes(1);
		}
	});

	it("preserves iframe content when moving a pane across columns, stacks, and tab groups", async () => {
		const frameLoaded = vi.fn();

		function Harness() {
			const [layout, setLayout] = useState(() =>
				createLayout(
					[
						{ id: "agent", kind: "agent", title: "Chat" },
						{ id: "terminal", kind: "tool", title: "Terminal" },
						{ id: "files", kind: "document", title: "Files" },
					],
					"terminal",
				),
			);
			return (
				<div style={{ width: 900, height: 500 }}>
					<PaneCanvas
						arrangement="carousel"
						kinds={[]}
						layout={layout}
						onLaunch={vi.fn()}
						onLayoutChange={setLayout}
						onSelectPane={vi.fn()}
						renderPane={(id) =>
							id === "terminal" ? (
								<iframe
									title="Terminal content"
									srcDoc='<input aria-label="Terminal buffer" value="Initial">'
									onLoad={frameLoaded}
								/>
							) : (
								<div data-pane-content={id}>{id}</div>
							)
						}
					/>
				</div>
			);
		}

		const { baseElement } = render(
			<StrictMode>
				<Harness />
			</StrictMode>,
		);
		await vi.waitFor(() => expect(frameLoaded).toHaveBeenCalledTimes(1));
		const frame = baseElement.querySelector("iframe")!;
		const frameDocument = frame.contentDocument!;
		const filesContent = baseElement.querySelector("[data-pane-content='files']")!;
		frameDocument.querySelector("input")!.value = "Shell history";

		const dragTerminal = (
			targetGroupId: string,
			position: "before" | "after" | "above" | "below" | "inside",
		) => {
			const source = baseElement.querySelector<HTMLElement>("[data-pane-tab='terminal']")!;
			const target = baseElement.querySelector<HTMLElement>(
				`[data-pane-group-id='${targetGroupId}']`,
			)!;
			const bounds = target.getBoundingClientRect();
			const tabStrip = target.querySelector<HTMLElement>("[data-pane-group-tabs]")!;
			const tabBounds = tabStrip.getBoundingClientRect();
			const x =
				position === "before"
					? bounds.left + 2
					: position === "after"
						? bounds.right - 2
						: bounds.left + bounds.width / 2;
			const y =
				position === "above" || position === "below"
					? position === "above"
						? bounds.top + 2
						: bounds.bottom - 2
					: position === "inside"
						? tabBounds.bottom + 24
						: bounds.top + bounds.height / 2;
			const drag = startPaneDrag(source);
			drag.move(x, y);
			drag.drop();
		};

		for (const [action, move] of [
			["Move terminal left", () => dragTerminal("group:agent", "before")],
			["Stack terminal", () => dragTerminal("group:files", "below")],
			["Move terminal above", () => dragTerminal("group:files", "above")],
			["Move terminal below", () => dragTerminal("group:files", "below")],
			["Move terminal left again", () => dragTerminal("group:agent", "before")],
			["Group terminal", () => dragTerminal("group:files", "inside")],
			["Split terminal", () => dragTerminal("group:agent", "after")],
		] as const) {
			move();
			await vi.waitFor(() =>
				expect(frame.closest("[data-qa-id='chat-pane-content-terminal']"), action).toBeTruthy(),
			);
			expect(baseElement.querySelector("iframe")).toBe(frame);
			expect(baseElement.querySelector("[data-pane-content='files']"), action).toBe(filesContent);
			expect(
				filesContent.closest(
					"[data-qa-id='chat-pane-content-files'], [data-qa-id='chat-pane-parked-files']",
				),
				action,
			).toBeTruthy();
			expect(frame.contentDocument, action).toBe(frameDocument);
			expect(frameDocument.querySelector("input")).toHaveValue("Shell history");
			expect(frameLoaded).toHaveBeenCalledTimes(1);
		}
	});

	it("keeps one visible unpin action on the top group of a pinned column", async () => {
		const initial = createLayout(
			[
				{
					id: "agent",
					kind: "agent",
					title: "Chat",
				},
				{
					id: "files",
					kind: "document",
					title: "Files",
				},
			],
			"agent",
		);
		const stacked = movePane(initial, "files", initial.groups[0]!.id, "below");
		const layout = togglePin(setActivePane(stacked, "agent"), stacked.groups[0]!.id);
		const topGroup = layout.groups[0]!;
		const lowerGroup = layout.groups[1]!;
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<PaneCanvas
					arrangement="carousel"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					onClosePane={vi.fn()}
					onPopOutPane={vi.fn()}
					renderPane={(paneId) => <div>{paneId}</div>}
				/>
			</div>,
		);
		const screen = page.elementLocator(baseElement);
		const pane = baseElement.querySelector("[data-qa-id='chat-pane-files']");
		const tab = baseElement.querySelector("[data-pane-tab='files']");
		const strip = baseElement.querySelector(`[data-pane-group-tabs='${topGroup.id}']`);
		const lowerStrip = baseElement.querySelector(`[data-pane-group-tabs='${lowerGroup.id}']`);
		const unpin = strip?.querySelector(`[data-qa-id='chat-pane-pin-${topGroup.id}']`);
		const add = strip?.querySelector("[data-qa-id='chat-pane-add-tab']");
		const column = strip?.closest("[data-column-id]");

		expect(strip?.contains(unpin ?? null)).toBe(true);
		expect(lowerStrip?.querySelector("[data-qa-id^='chat-pane-pin-']")).toBeNull();
		expect(tab?.contains(unpin ?? null)).toBe(false);
		expect(baseElement.querySelectorAll("[data-qa-id^='chat-pane-pin-']")).toHaveLength(1);
		expect(unpin?.querySelector(".lucide-pin-off")).not.toBeNull();
		expect(unpin).toHaveAttribute("aria-label", "Unpin column");
		expect(unpin).toHaveAttribute("aria-pressed", "true");
		expect(column).toHaveAttribute("data-pinned", "true");
		expect(pane?.querySelector("[data-qa-id='chat-pane-header']")).toBeNull();
		const stripBox = strip?.getBoundingClientRect();
		const addBox = add?.getBoundingClientRect();
		const unpinBox = unpin?.getBoundingClientRect();
		expect(addBox?.right).toBeLessThan(unpinBox?.left ?? 0);
		expect(unpinBox?.right).toBeGreaterThan((stripBox?.right ?? 0) - 10);

		const filesTab = baseElement.querySelector("[data-pane-tab='files']");
		const agentTab = baseElement.querySelector("[data-pane-tab='agent']");
		expect(filesTab).not.toHaveAttribute("data-pinned");
		expect(agentTab).toHaveAttribute("data-active", "true");

		await screen.getByTestId("chat-pane-tab-agent").hover();
		await vi.waitFor(() => expect(unpin && getComputedStyle(unpin).opacity).toBe("1"));
	});

	it("keeps the selected pane active when its column is pinned", async () => {
		const initial = createLayout(
			[
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "files", kind: "document", title: "Files" },
			],
			"agent",
		);
		const layout = {
			...initial,
			groups: initial.groups.map((group) =>
				group.tabs.some((pane) => pane.id === "agent") ? { ...group, pinned: true } : group,
			),
		};
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<PaneCanvas
					arrangement="carousel"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					onClosePane={vi.fn()}
					renderPane={(paneId) => <div>{paneId}</div>}
				/>
			</div>,
		);

		const tab = baseElement.querySelector("[data-pane-tab='agent']");
		const column = tab?.closest("[data-column-id]");
		expect(column).toHaveAttribute("data-pinned", "true");
		expect(tab).not.toHaveAttribute("data-pinned");
		expect(tab).toHaveAttribute("data-active", "true");
	});

	it("lets the user scroll back to the leading pane after selecting one at the end", async () => {
		function Harness() {
			const [layout, setLayout] = useState(() =>
				(() => {
					const initial = createLayout(
						[
							{ id: "agent", kind: "agent", title: "Chat" },
							{ id: "files", kind: "document", title: "Files" },
							{ id: "end", kind: "tool", title: "Output" },
						],
						"agent",
					);
					return {
						...initial,
						groups: initial.groups.map((group) => ({ ...group, preferredWidth: 640 })),
					};
				})(),
			);
			return (
				<div style={{ width: 420, maxWidth: 420, height: 360, overflow: "hidden" }}>
					<PaneCanvas
						arrangement="carousel"
						kinds={[]}
						layout={layout}
						onLaunch={vi.fn()}
						onLayoutChange={setLayout}
						onSelectPane={(paneId) => setLayout((current) => setActivePane(current, paneId))}
						renderPane={(paneId) => <div>{paneId}</div>}
					/>
				</div>
			);
		}

		const { baseElement } = render(<Harness />);
		const screen = page.elementLocator(baseElement);
		const track = baseElement.querySelector<HTMLElement>("[data-qa-id='chat-pane-carousel-track']");
		expect(track).toBeTruthy();
		if (!track) return;

		await vi.waitFor(() => {
			expect(track.clientWidth).toBeLessThan(500);
			expect(track.scrollWidth).toBeGreaterThan(track.clientWidth + 400);
		});

		await screen.getByTestId("chat-pane-tab-end").click({ force: true });
		await vi.waitFor(() => expect(track.scrollLeft).toBeGreaterThan(100));

		track.dispatchEvent(
			new WheelEvent("wheel", { deltaX: -240, deltaY: 0, bubbles: true, cancelable: true }),
		);
		const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		track.scrollLeft = 0;
		await nextFrame();
		await nextFrame();
		await nextFrame();
		expect(track.scrollLeft).toBeLessThan(50);

		track.scrollLeft = 0;
		await nextFrame();
		await nextFrame();
		await nextFrame();
		expect(track.scrollLeft).toBeLessThan(50);
	});

	it("reveals the active pane immediately when the reveal nonce changes", async () => {
		function Harness() {
			const [layout, setLayout] = useState(() => {
				const initial = createLayout(
					[
						{ id: "agent", kind: "agent", title: "Chat" },
						{ id: "files", kind: "document", title: "Files" },
						{ id: "end", kind: "tool", title: "Output" },
					],
					"agent",
				);
				return {
					...initial,
					groups: initial.groups.map((group) => ({ ...group, preferredWidth: 640 })),
				};
			});
			const [nonce, setNonce] = useState(0);
			return (
				<div style={{ width: 420, maxWidth: 420, height: 360, overflow: "hidden" }}>
					<PaneCanvas
						arrangement="carousel"
						kinds={[]}
						layout={layout}
						revealActivePaneNonce={nonce}
						onLaunch={vi.fn()}
						onLayoutChange={setLayout}
						onSelectPane={(paneId) => setLayout((current) => setActivePane(current, paneId))}
						renderPane={(paneId) => <div>{paneId}</div>}
					/>
					<button
						type="button"
						data-qa-id="bump-reveal"
						onClick={() => setNonce((value) => value + 1)}
					>
						Reveal
					</button>
				</div>
			);
		}

		const { baseElement } = render(<Harness />);
		const screen = page.elementLocator(baseElement);
		const track = baseElement.querySelector<HTMLElement>("[data-qa-id='chat-pane-carousel-track']");
		expect(track).toBeTruthy();
		if (!track) return;

		await vi.waitFor(() => {
			expect(track.scrollWidth).toBeGreaterThan(track.clientWidth + 400);
		});

		track.dispatchEvent(
			new WheelEvent("wheel", { deltaX: 240, deltaY: 0, bubbles: true, cancelable: true }),
		);
		track.scrollLeft = track.scrollWidth - track.clientWidth;
		expect(track.scrollLeft).toBeGreaterThan(100);

		await screen.getByTestId("bump-reveal").click({ force: true });
		await vi.waitFor(() => expect(track.scrollLeft).toBeLessThan(50));
	});

	it("lets Shift+wheel pan the carousel when the active pane also scrolls", async () => {
		function Harness() {
			const [layout, setLayout] = useState(() => {
				const initial = createLayout(
					[
						{ id: "agent", kind: "agent", title: "Chat" },
						{ id: "files", kind: "document", title: "Files" },
						{ id: "end", kind: "tool", title: "Output" },
					],
					"agent",
				);
				return {
					...initial,
					groups: initial.groups.map((group) => ({ ...group, preferredWidth: 640 })),
				};
			});
			return (
				<div style={{ width: 420, maxWidth: 420, height: 360, overflow: "hidden" }}>
					<PaneCanvas
						arrangement="carousel"
						kinds={[]}
						layout={layout}
						onLaunch={vi.fn()}
						onLayoutChange={setLayout}
						onSelectPane={(paneId) => setLayout((current) => setActivePane(current, paneId))}
						renderPane={() => (
							<div data-qa-id="overflow-pane" style={{ height: "100%", overflow: "auto" }}>
								<div style={{ height: 1200 }}>tall</div>
							</div>
						)}
					/>
				</div>
			);
		}

		const { baseElement } = render(<Harness />);
		const track = baseElement.querySelector<HTMLElement>("[data-qa-id='chat-pane-carousel-track']");
		const pane = baseElement.querySelector<HTMLElement>("[data-qa-id='overflow-pane']");
		expect(track).toBeTruthy();
		expect(pane).toBeTruthy();
		if (!track || !pane) return;

		await vi.waitFor(() => {
			expect(track.scrollWidth).toBeGreaterThan(track.clientWidth + 400);
			expect(pane.scrollHeight).toBeGreaterThan(pane.clientHeight + 100);
		});

		const origin = track.scrollLeft;
		pane.dispatchEvent(
			new WheelEvent("wheel", { deltaX: 0, deltaY: 120, bubbles: true, cancelable: true }),
		);
		expect(track.scrollLeft).toBe(origin);

		pane.dispatchEvent(
			new WheelEvent("wheel", {
				deltaX: 0,
				deltaY: 120,
				shiftKey: true,
				bubbles: true,
				cancelable: true,
			}),
		);
		expect(track.scrollLeft).toBeGreaterThan(origin);
	});

	it("lets Shift+wheel pan the carousel even when a nested pane stops the event", async () => {
		function Harness() {
			const [layout, setLayout] = useState(() => {
				const initial = createLayout(
					[
						{ id: "agent", kind: "agent", title: "Chat" },
						{ id: "files", kind: "document", title: "Files" },
						{ id: "end", kind: "tool", title: "Output" },
					],
					"agent",
				);
				return {
					...initial,
					groups: initial.groups.map((group) => ({ ...group, preferredWidth: 640 })),
				};
			});
			return (
				<div style={{ width: 420, maxWidth: 420, height: 360, overflow: "hidden" }}>
					<PaneCanvas
						arrangement="carousel"
						kinds={[]}
						layout={layout}
						onLaunch={vi.fn()}
						onLayoutChange={setLayout}
						onSelectPane={(paneId) => setLayout((current) => setActivePane(current, paneId))}
						renderPane={() => (
							<div
								data-qa-id="capturing-pane"
								style={{ height: "100%", overflow: "auto" }}
								onWheel={(event) => event.stopPropagation()}
							>
								<div style={{ height: 1200 }}>tall</div>
							</div>
						)}
					/>
				</div>
			);
		}

		const { baseElement } = render(<Harness />);
		const canvas = baseElement.querySelector<HTMLElement>("[data-qa-id='kilo-chat-pane-canvas']");
		const track = baseElement.querySelector<HTMLElement>("[data-qa-id='chat-pane-carousel-track']");
		const pane = baseElement.querySelector<HTMLElement>("[data-qa-id='capturing-pane']");
		expect(canvas).toBeTruthy();
		expect(track).toBeTruthy();
		expect(pane).toBeTruthy();
		if (!canvas || !track || !pane) return;

		await vi.waitFor(() => {
			expect(track.scrollWidth).toBeGreaterThan(track.clientWidth + 400);
		});

		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
		const surface = canvas.querySelector<HTMLElement>("[data-pan-surface='true']");
		expect(surface?.style.pointerEvents).toBe("none");

		const origin = track.scrollLeft;
		pane.dispatchEvent(
			new WheelEvent("wheel", {
				deltaX: 0,
				deltaY: 160,
				shiftKey: true,
				bubbles: true,
				cancelable: true,
			}),
		);
		expect(track.scrollLeft).toBeGreaterThan(origin);
		window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
	});

	it("describes a pane pill with its title hint and keeps the pane header title-free", async () => {
		const layout = createLayout([{ id: "files", kind: "document", title: "workspace-1" }], "files");
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					paneTitleHint={(paneId) => (paneId === "files" ? "/projects/workspace-1" : undefined)}
					renderPane={() => null}
				/>
			</div>,
		);
		const screen = page.elementLocator(baseElement);
		const tab = screen.getByTestId("chat-pane-tab-files");
		await expect.element(tab).toHaveTextContent("workspace-1");
		await expect.element(tab).toHaveAttribute("aria-description", "/projects/workspace-1");
		await expect.element(screen.getByTestId("chat-pane-title")).not.toBeInTheDocument();
		await expect.element(tab).not.toHaveAttribute("title");
	});

	it("shows the add-pane control on an unselected tab group when its tab strip is hovered", async () => {
		const layout = createLayout(
			[
				{ id: "files", kind: "document", title: "Files" },
				{ id: "output", kind: "tool", title: "Output" },
			],
			"output",
		);
		const filesGroupId = layout.groups.find((group) =>
			group.tabs.some((tab) => tab.id === "files"),
		)?.id;
		const launch = vi.fn();
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[terminalKind]}
					layout={layout}
					onLaunch={launch}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					renderPane={(paneId) => <div>{paneId}</div>}
				/>
			</div>,
		);
		const screen = page.elementLocator(baseElement);
		const strip = baseElement.querySelector(`[data-pane-group-tabs='${filesGroupId}']`);
		const add = strip?.querySelector<HTMLElement>("[data-qa-id='chat-pane-add-tab']");
		const selectedAdd = baseElement.querySelector<HTMLElement>(
			"[data-qa-id='chat-pane-tabs'][data-selected] [data-qa-id='chat-pane-add-tab']",
		);

		expect(filesGroupId).toBeTruthy();
		expect(add).toBeTruthy();
		expect(add && getComputedStyle(add).opacity).toBe("0");
		expect(selectedAdd && getComputedStyle(selectedAdd).opacity).toBe("1");

		await screen.getByTestId("chat-pane-tab-files").hover();
		await vi.waitFor(() => {
			expect(add && getComputedStyle(add).opacity).toBe("1");
		});

		await page.elementLocator(add!).click();
		await page.getByTestId("chat-pane-add-menu-kilo.terminal/terminal").click();
		expect(launch).toHaveBeenCalledWith(terminalKind, filesGroupId);
	});
	it("shows directional overflow arrows and scrolls the tab strip without selecting a tab", async () => {
		let layout = createLayout(
			[
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "notes", kind: "document", title: "Notes" },
				{ id: "files", kind: "document", title: "Files" },
				{ id: "output", kind: "tool", title: "Output" },
			],
			"agent",
		);
		for (const id of ["notes", "files", "output"]) {
			layout = movePaneToGroup(layout, id, "group:agent");
		}
		layout = setActivePane(layout, "agent");
		const onSelectPane = vi.fn();
		const view = (width: number) => (
			<div style={{ display: "flex", width, height: 400 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={onSelectPane}
					renderPane={() => null}
				/>
			</div>
		);
		const { baseElement, rerender } = render(view(560));
		const screen = page.elementLocator(baseElement);
		const left = screen.getByRole("button", { name: "Scroll tabs left" });
		const right = screen.getByRole("button", { name: "Scroll tabs right" });
		await expect.element(left).not.toBeInTheDocument();
		await expect.element(right).toBeVisible();
		await right.click();
		await expect.element(left).toBeVisible();
		await expect.element(right).not.toBeInTheDocument();
		await left.click();
		await expect.element(left).not.toBeInTheDocument();
		await expect.element(right).toBeVisible();
		expect(onSelectPane).not.toHaveBeenCalled();
		rerender(view(1540));
		await expect.element(left).not.toBeInTheDocument();
		await expect.element(right).not.toBeInTheDocument();
		rerender(view(560));
		await expect.element(right).toBeVisible();

		for (const id of ["notes", "files", "output"]) layout = removePane(layout, id);
		rerender(view(560));

		await vi.waitFor(() => {
			const strip = screen.getByTestId("chat-pane-tabs").element();
			expect(strip.scrollWidth).toBeLessThanOrEqual(strip.clientWidth);
			expect(strip.scrollLeft).toBe(0);
			expect(strip).not.toHaveAttribute("data-overflow-left");
			expect(strip).not.toHaveAttribute("data-overflow-right");
		});
		await expect
			.element(screen.getByRole("button", { name: "Scroll tabs left" }))
			.not.toBeInTheDocument();
	});
	it("reveals newly active tabs past either edge without interrupting manual scrolling", async () => {
		await page.viewport(1260, 600);
		let layout = createLayout(
			[
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "notes", kind: "document", title: "Notes" },
				{ id: "files", kind: "document", title: "Files" },
				{ id: "output", kind: "document", title: "Output" },
				{ id: "logs", kind: "document", title: "Logs" },
			],
			"agent",
		);
		for (const id of ["notes", "files", "output", "logs"]) {
			layout = movePaneToGroup(layout, id, "group:agent");
		}
		layout = setActivePane(layout, "agent");
		const view = () => (
			<div style={{ display: "flex", width: 560, height: 400 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					renderPane={() => null}
				/>
			</div>
		);
		const { baseElement, rerender } = render(view());
		const screen = page.elementLocator(baseElement);
		const strip = screen.getByTestId("chat-pane-tabs").element();
		const expectRevealed = (id: string) =>
			vi.waitFor(() => {
				const bounds = strip.getBoundingClientRect();
				const tab = screen.getByTestId(`chat-pane-tab-${id}`).element().closest("[data-pane-tab]")!;
				const tabBounds = tab.getBoundingClientRect();
				const leftArrow = baseElement.querySelector('[aria-label="Scroll tabs left"]');
				const rightArrow = baseElement.querySelector('[aria-label="Scroll tabs right"]');
				expect(tabBounds.left).toBeGreaterThanOrEqual(
					leftArrow?.getBoundingClientRect().right ?? bounds.left,
				);
				expect(tabBounds.right).toBeLessThanOrEqual(
					rightArrow?.getBoundingClientRect().left ?? bounds.right,
				);
			});
		layout = setActivePane(layout, "notes");
		rerender(view());
		await expectRevealed("notes");
		expect(strip.scrollLeft).toBe(0);
		layout = setActivePane(layout, "output");
		rerender(view());
		await expectRevealed("output");
		layout = setActivePane(layout, "notes");
		rerender(view());
		await expectRevealed("notes");
		layout = setActivePane(layout, "logs");
		rerender(view());
		await expectRevealed("logs");
		await vi.waitFor(() => {
			const add = screen.getByRole("button", { name: "Add tab" }).element().getBoundingClientRect();
			const bounds = strip.getBoundingClientRect();
			expect(add.left).toBeGreaterThanOrEqual(bounds.left);
			expect(add.right).toBeLessThanOrEqual(bounds.right);
		});
		await expect
			.element(screen.getByRole("button", { name: "Scroll tabs right" }))
			.not.toBeInTheDocument();
		strip.scrollLeft = 0;
		fireEvent.scroll(strip);
		const manualScrollLeft = strip.scrollLeft;
		rerender(view());
		expect(strip.scrollLeft).toBe(manualScrollLeft);
		expect(window.scrollX).toBe(0);
		expect(window.scrollY).toBe(0);
	});
	it("reveals an appended tab and lets the user scroll back without snapping to the end", async () => {
		let layout = createLayout(
			[
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "notes", kind: "document", title: "Notes" },
				{ id: "files", kind: "document", title: "Files" },
			],
			"agent",
		);
		layout = movePaneToGroup(layout, "notes", "group:agent");
		layout = movePaneToGroup(layout, "files", "group:agent");
		layout = setActivePane(layout, "agent");
		const view = () => (
			<div style={{ display: "flex", width: 400, height: 400 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					renderPane={() => null}
				/>
			</div>
		);
		const { baseElement, rerender } = render(view());
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByRole("button", { name: "Scroll tabs right" })).toBeVisible();
		layout = movePaneToGroup(
			addPane(layout, { id: "new-notebook", kind: "notebook", title: "New notebook" }),
			"new-notebook",
			"group:agent",
		);
		rerender(view());
		const strip = screen.getByTestId("chat-pane-tabs").element();
		const tab = screen.getByTestId("chat-pane-tab-new-notebook").element();
		await vi.waitFor(() => {
			const bounds = strip.getBoundingClientRect();
			const tabBounds = tab.getBoundingClientRect();
			expect(tabBounds.left).toBeGreaterThanOrEqual(bounds.left);
			expect(tabBounds.right).toBeLessThanOrEqual(bounds.right);
		});
		await expect
			.element(screen.getByRole("button", { name: "Scroll tabs right" }))
			.not.toBeInTheDocument();
		await screen.getByRole("button", { name: "Scroll tabs left" }).click();
		await expect.element(screen.getByRole("button", { name: "Scroll tabs right" })).toBeVisible();
		const scrollLeft = strip.scrollLeft;
		rerender(view());
		expect(strip.scrollLeft).toBe(scrollLeft);
	});
	it("dismisses tab tooltips during scrolling and restores them after scrolling stops", async () => {
		await page.viewport(420, 420);
		const expectTooltipHidden = () =>
			vi.waitFor(() => {
				const tooltip = document.querySelector('[data-slot="tooltip-content"]');
				expect(tooltip?.checkVisibility() ?? false).toBe(false);
			});
		const overflowingFrames: { width: number; height: number }[] = [];
		let frame = 0;
		const sampleOverflow = () => {
			const root = document.documentElement;
			if (root.scrollWidth > root.clientWidth || root.scrollHeight > root.clientHeight) {
				overflowingFrames.push({ width: root.scrollWidth, height: root.scrollHeight });
			}
			frame = requestAnimationFrame(sampleOverflow);
		};
		frame = requestAnimationFrame(sampleOverflow);
		onTestFinished(() => cancelAnimationFrame(frame));
		let layout = createLayout(
			[
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "notes", kind: "document", title: "Notes" },
				{ id: "files", kind: "document", title: "Files" },
			],
			"agent",
		);
		layout = movePaneToGroup(layout, "notes", "group:agent");
		layout = movePaneToGroup(layout, "files", "group:agent");
		layout = setActivePane(layout, "agent");
		const { baseElement } = render(
			<div
				style={{
					display: "flex",
					width: 400,
					height: 48,
					position: "absolute",
					bottom: 0,
					right: 0,
				}}
			>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					onPopOutPane={vi.fn()}
					renderPane={() => null}
				/>
			</div>,
		);
		const screen = page.elementLocator(baseElement);
		await screen.getByTestId("chat-pane-tab-agent").hover();
		const popOut = screen.getByTestId("chat-pane-pop-out-tab-agent");
		await popOut.hover();
		await expect.element(page.getByText("Pop out", { exact: true })).toBeVisible();
		const strip = screen.getByTestId("chat-pane-tabs").element();
		fireEvent.wheel(strip, { deltaX: 1 });
		await expectTooltipHidden();
		strip.scrollLeft = 1;
		fireEvent.scroll(strip);
		await expectTooltipHidden();
		await screen.getByRole("tabpanel", { name: "Chat" }).hover();
		await expectTooltipHidden();
		await expect.element(popOut).not.toHaveAttribute("data-trigger-disabled");
		await popOut.hover();
		await expect.element(page.getByText("Pop out", { exact: true })).toBeVisible();
		strip.scrollLeft = strip.scrollWidth;
		fireEvent.scroll(strip);
		await expectTooltipHidden();
		expect(overflowingFrames).toEqual([]);
	});
	it("keeps only one tooltip visible when moving between tab actions", async () => {
		await page.viewport(900, 600);
		const layout = createLayout(
			[
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "notes", kind: "document", title: "Notes" },
			],
			"agent",
		);
		const { baseElement } = render(
			<div style={{ display: "flex", width: 850, height: 500 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					onPopOutPane={vi.fn()}
					renderPane={() => null}
				/>
			</div>,
		);
		const screen = page.elementLocator(baseElement);
		const expand = screen.getByTestId("chat-pane-expand-agent");
		const popOut = screen.getByTestId("chat-pane-pop-out-tab-agent");
		await screen.getByTestId("chat-pane-tab-notes").hover();
		await expand.hover();
		expand.element().focus();
		await vi.waitFor(() =>
			expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent("Expand"),
		);
		await popOut.hover();
		await vi.waitFor(() => {
			const popups = document.querySelectorAll('[data-slot="tooltip-content"]');
			expect(popups).toHaveLength(1);
			expect(popups[0]).toHaveTextContent("Pop out");
		});
		await expand.hover();
		await vi.waitFor(() => {
			const popups = document.querySelectorAll('[data-slot="tooltip-content"]');
			expect(popups).toHaveLength(1);
			expect(popups[0]).toHaveTextContent("Expand");
		});
	});

	it("lets the host keep a pane open by refusing its close action", async () => {
		const layout = createLayout(
			[
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "terminal", kind: "tool", title: "Terminal" },
			],
			"agent",
		);
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					onClosePane={vi.fn()}
					canClosePane={(paneId) => paneId !== "agent"}
					renderPane={(paneId) => <div>{paneId}</div>}
				/>
			</div>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("chat-pane-close-tab-terminal")).toBeInTheDocument();
		await expect.element(screen.getByTestId("chat-pane-close-tab-agent")).not.toBeInTheDocument();
	});

	it("overlays shortcut hint chips on tabs in place of their actions", async () => {
		const layout = createLayout(
			[
				{ id: "agent", kind: "agent", title: "Chat" },
				{ id: "terminal", kind: "tool", title: "Terminal" },
			],
			"agent",
		);
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<PaneCanvas
					arrangement="tiles"
					kinds={[]}
					layout={layout}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					onClosePane={vi.fn()}
					shortcutHints={new Map([["terminal", "⌘2"]])}
					renderPane={(paneId) => <div>{paneId}</div>}
				/>
			</div>,
		);
		const terminalTab = baseElement.querySelector("[data-pane-tab='terminal']");
		const agentTab = baseElement.querySelector("[data-pane-tab='agent']");

		expect(terminalTab?.querySelector("[data-slot='shortcut-hint']")).toHaveTextContent("⌘2");
		expect(agentTab?.querySelector("[data-slot='shortcut-hint']")).toBeNull();
		await expect.element(page.getByTestId("chat-pane-close-tab-terminal")).not.toBeVisible();
	});
});
