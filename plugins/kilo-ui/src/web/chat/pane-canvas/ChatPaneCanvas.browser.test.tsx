import { cleanup, fireEvent, render } from "@testing-library/react";
import { useLayoutEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	createLayout,
	movePane,
	movePaneToGroup,
	setActivePane,
	togglePin,
} from "@anaconda-agentic-desktop/pane-layout";

import { ChatPaneCanvas } from "./ChatPaneCanvas.js";

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

describe("ChatPaneCanvas", () => {
	it("keeps a lone pane and pill neutral while preserving active semantics", () => {
		const layout = createLayout([{ id: "agent", kind: "agent", title: "Chat" }], "agent");
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<ChatPaneCanvas
					arrangement="tiles"
					definitions={[]}
					layout={layout}
					onLaunchChat={vi.fn()}
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
		expect(tab?.className).toMatch(/border-border/);
		expect(tab?.className).not.toMatch(/border-info/);
		expect(tab?.className).not.toMatch(/bg-sidebar-accent/);
		expect(frame?.className).toMatch(/border-border/);
		expect(frame?.className).not.toMatch(/border-info/);
	});

	it("offers focus and dock actions in place of popped-out pane content", async () => {
		const layout = createLayout([{ id: "files", kind: "document", title: "Files" }], "files");
		const focus = vi.fn();
		const dock = vi.fn();
		const renderPane = vi.fn(() => <div>Files content</div>);
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<ChatPaneCanvas
					arrangement="tiles"
					definitions={[]}
					layout={layout}
					onLaunchChat={vi.fn()}
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
					<ChatPaneCanvas
						arrangement="tiles"
						definitions={[]}
						layout={layout}
						onLaunchChat={vi.fn()}
						onLaunch={vi.fn()}
						onLayoutChange={setLayout}
						onSelectPane={(paneId) => setLayout((current) => setActivePane(current, paneId))}
						renderPane={(paneId) => <StatefulPane paneId={paneId} />}
					/>
				</div>
			);
		}

		const { baseElement } = render(<Harness />);
		const screen = page.elementLocator(baseElement);
		const groupedHook = `chat-pane-group-${grouped.groups[0]!.id}`;
		const group = baseElement.querySelector(`[data-qa-id='${groupedHook}']`);

		expect(baseElement.querySelectorAll("[data-qa-id='chat-pane-tabs']")).toHaveLength(2);
		expect(group?.querySelectorAll("[role='tab']")).toHaveLength(2);
		expect(baseElement.querySelectorAll("[data-pane-tab][data-active='true']")).toHaveLength(1);
		expect(baseElement.querySelectorAll("[data-qa-id='chat-pane-parked-files']")).toHaveLength(1);
		expect(baseElement.querySelector("[data-qa-id='chat-pane-parked-files']")).not.toBeVisible();
		const strip = group?.querySelector<HTMLElement>("[data-qa-id='chat-pane-tabs']");
		const pane = group?.querySelector<HTMLElement>("[data-qa-id='chat-pane-agent']");
		expect(strip?.getBoundingClientRect().height).toBe(28);
		expect(pane?.getBoundingClientRect().top).toBeLessThanOrEqual(
			(strip?.getBoundingClientRect().bottom ?? 0) + 4,
		);

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
		await screen.getByRole("button", { name: "files:0" }).click();
		await screen.getByTestId("chat-pane-tab-agent").click();
		await screen.getByTestId("chat-pane-tab-files").click();

		await expect.element(screen.getByRole("button", { name: "files:1" })).toBeVisible();
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
				<ChatPaneCanvas
					arrangement="tiles"
					definitions={[]}
					layout={layout}
					onLaunchChat={vi.fn()}
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
					<ChatPaneCanvas
						arrangement="carousel"
						definitions={[]}
						layout={layout}
						onLaunchChat={vi.fn()}
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
				<ChatPaneCanvas
					arrangement="tiles"
					definitions={[]}
					layout={stacked}
					onLaunchChat={vi.fn()}
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
				<ChatPaneCanvas
					arrangement="tiles"
					definitions={[]}
					layout={stacked}
					onLaunchChat={vi.fn()}
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
					<ChatPaneCanvas
						arrangement="tiles"
						definitions={[]}
						layout={layout}
						onLaunchChat={vi.fn()}
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
					<ChatPaneCanvas
						arrangement="tiles"
						definitions={[]}
						layout={layout}
						onLaunchChat={vi.fn()}
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
				<ChatPaneCanvas
					arrangement="carousel"
					definitions={[]}
					layout={layout}
					onLaunchChat={vi.fn()}
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

	it("styles a pinned column and keeps one unpin action on its top group strip", async () => {
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
				<ChatPaneCanvas
					arrangement="carousel"
					definitions={[]}
					layout={layout}
					onLaunchChat={vi.fn()}
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
		expect(unpin).toHaveClass(
			"h-7",
			"w-7",
			"border-border",
			"bg-card/70",
			"text-amber-600",
			"opacity-100",
		);
		expect(unpin).not.toHaveClass("opacity-0");
		const outline = column?.querySelector("[data-qa-id='chat-pane-column-pin-outline']");
		expect(outline).toHaveClass(
			"pointer-events-none",
			"absolute",
			"inset-0",
			"border-amber-500/70",
		);
		expect(column).not.toHaveClass("border-amber-500/70", "ring-1", "ring-offset-1", "p-0.5");
		expect(column).not.toHaveAttribute("data-pin-intent");
		expect(pane?.querySelector("[data-qa-id='chat-pane-header']")).toBeNull();
		const stripBox = strip?.getBoundingClientRect();
		const addBox = add?.getBoundingClientRect();
		const unpinBox = unpin?.getBoundingClientRect();
		expect(addBox?.right).toBeLessThan(unpinBox?.left ?? 0);
		expect(unpinBox?.right).toBeGreaterThan((stripBox?.right ?? 0) - 2);

		const filesTab = baseElement.querySelector("[data-pane-tab='files']");
		const agentTab = baseElement.querySelector("[data-pane-tab='agent']");
		const filesFrame = pane?.querySelector("[data-qa-id='chat-pane-frame']");
		expect(filesTab).not.toHaveAttribute("data-pinned");
		expect(filesTab?.className).toMatch(/border-border/);
		expect(filesTab?.className).not.toMatch(/border-primary/);
		expect(filesTab?.className).not.toMatch(/border-info-foreground/);
		expect(filesFrame?.className).toMatch(/border-border/);
		expect(filesFrame?.className).not.toMatch(/border-primary/);
		expect(filesFrame?.className).not.toMatch(/border-info-foreground/);
		const agentFrame = baseElement.querySelector(
			"[data-qa-id='chat-pane-agent'] [data-qa-id='chat-pane-frame']",
		);
		expect(agentFrame?.className).not.toMatch(/border-info-foreground/);
		expect(agentTab).toHaveAttribute("data-active", "true");
		expect(agentTab?.className).toMatch(/border-info-foreground/);
		expect(agentTab?.className).not.toMatch(/border-primary/);

		await screen.getByTestId("chat-pane-tab-agent").hover();
		await vi.waitFor(() => expect(unpin && getComputedStyle(unpin).opacity).toBe("1"));
		await screen.getByTestId(`chat-pane-pin-${topGroup.id}`).hover();
		await vi.waitFor(() => expect(column).toHaveAttribute("data-pin-intent", "true"));
		expect(outline).toHaveClass("border-amber-500");
		expect(column).not.toHaveClass("border-amber-500", "ring-2");
	});

	it("keeps selected pane chrome active while placing the pinned treatment on its column", async () => {
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
				<ChatPaneCanvas
					arrangement="carousel"
					definitions={[]}
					layout={layout}
					onLaunchChat={vi.fn()}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					onClosePane={vi.fn()}
					renderPane={(paneId) => <div>{paneId}</div>}
				/>
			</div>,
		);

		const tab = baseElement.querySelector("[data-pane-tab='agent']");
		const frame = baseElement.querySelector(
			"[data-qa-id='chat-pane-agent'] [data-qa-id='chat-pane-frame']",
		);
		const column = tab?.closest("[data-column-id]");
		const outline = column?.querySelector("[data-qa-id='chat-pane-column-pin-outline']");
		expect(column).toHaveAttribute("data-pinned", "true");
		expect(outline).toHaveClass(
			"pointer-events-none",
			"absolute",
			"inset-0",
			"z-50",
			"border-amber-500/70",
		);
		expect(column?.lastElementChild).toBe(outline);
		expect(column).not.toHaveClass("border-amber-500/70", "ring-1", "ring-offset-1", "p-0.5");
		expect(tab).not.toHaveAttribute("data-pinned");
		expect(tab).toHaveAttribute("data-active", "true");
		expect(tab?.className).toMatch(/border-info-foreground/);
		expect(tab?.className).not.toMatch(/border-primary/);
		expect(tab?.className).toMatch(/bg-sidebar-accent/);
		expect(tab?.className).not.toMatch(/bg-info/);
		expect(frame?.className).not.toMatch(/border-info-foreground/);
		expect(frame?.className).not.toMatch(/border-primary/);
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
					<ChatPaneCanvas
						arrangement="carousel"
						definitions={[]}
						layout={layout}
						onLaunchChat={vi.fn()}
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
		track.scrollLeft = 0;
		await new Promise((resolve) => setTimeout(resolve, 450));
		expect(track.scrollLeft).toBeLessThan(50);

		track.scrollLeft = 0;
		await new Promise((resolve) => setTimeout(resolve, 450));
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
					<ChatPaneCanvas
						arrangement="carousel"
						definitions={[]}
						layout={layout}
						revealActivePaneNonce={nonce}
						onLaunchChat={vi.fn()}
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
					<ChatPaneCanvas
						arrangement="carousel"
						definitions={[]}
						layout={layout}
						onLaunchChat={vi.fn()}
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
					<ChatPaneCanvas
						arrangement="carousel"
						definitions={[]}
						layout={layout}
						onLaunchChat={vi.fn()}
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

	it("shows the agent name on the pane pill and keeps the pane header title-free", async () => {
		const layout = createLayout([{ id: "agent", kind: "agent", title: "Code" }], "agent");
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<ChatPaneCanvas
					arrangement="tiles"
					definitions={[]}
					layout={layout}
					onLaunchChat={vi.fn()}
					onLaunch={vi.fn()}
					onLayoutChange={vi.fn()}
					onSelectPane={vi.fn()}
					renderPane={() => null}
				/>
			</div>,
		);
		const screen = page.elementLocator(baseElement);
		const tab = screen.getByTestId("chat-pane-tab-agent");
		await expect.element(tab).toHaveTextContent("Code");
		await expect.element(tab).toHaveAttribute("title", "Code");
		await expect.element(screen.getByTestId("chat-pane-title")).not.toBeInTheDocument();
	});

	it("shows the workspace root on the explorer pill and keeps the pane header title-free", async () => {
		const layout = createLayout([{ id: "files", kind: "document", title: "workspace-1" }], "files");
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<ChatPaneCanvas
					arrangement="tiles"
					definitions={[]}
					layout={layout}
					onLaunchChat={vi.fn()}
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
		await expect.element(screen.getByTestId("chat-pane-title")).not.toBeInTheDocument();
		await expect.element(tab).toHaveAttribute("title", "/projects/workspace-1");
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
		const launchChat = vi.fn();
		const { baseElement } = render(
			<div style={{ display: "flex", width: 900, height: 400 }}>
				<ChatPaneCanvas
					arrangement="tiles"
					definitions={[]}
					layout={layout}
					onLaunchChat={launchChat}
					onLaunch={vi.fn()}
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
		expect(add).toHaveClass("opacity-0");
		expect(add).not.toHaveClass("opacity-100");
		expect(selectedAdd && getComputedStyle(selectedAdd).opacity).toBe("1");

		await screen.getByTestId("chat-pane-tab-files").hover();
		await vi.waitFor(() => {
			expect(add && getComputedStyle(add).opacity).toBe("1");
		});

		await page.elementLocator(add!).click();
		await page.getByTestId("chat-pane-add-menu-chat").click();
		expect(launchChat).toHaveBeenCalledWith(filesGroupId);
	});
});
