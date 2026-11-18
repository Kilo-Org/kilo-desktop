// Pane canvas performance benchmarks (run with
// `pnpm --filter @kilo-desktop/plugin-work-sessions perf`): dragging a
// column splitter, switching panes and adding a tab, in a real kernel with
// kilo.work-sessions' real web entry. Panes render a heavy body (as chat and
// files panes do) and count their renders. Each scenario logs one
// `PERF {…}` line; compare them on the same machine before and after a change.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, page } from "vitest/browser";

import { createLayout, descriptor, serializeLayout } from "@kilo-desktop/pane-layout";

import { EMPTY_WORK_SESSION_PANES, type PaneProps } from "../contracts";
import { paneKindPlugin, pane, renderWorkSessions, workSession, workspace } from "../testing";

const SESSION = workSession("wses_1", { title: "Perf", workspaceId: "w-app" });
const APP = workspace("w-app", "App", {
	folders: [{ id: "f", path: "/projects/app", isPrimary: true, position: 0 }],
});

const renders = new Map<string, number>();
const totalRenders = () => [...renders.values()].reduce((sum, count) => sum + count, 0);

/** A pane with a body as heavy as a transcript's or a file tree's. */
function HeavyPane({ pane: { id }, visible }: PaneProps) {
	renders.set(id, (renders.get(id) ?? 0) + 1);
	return (
		<div data-qa-id={`heavy-${id}`} data-visible={visible} className="h-full overflow-auto">
			{Array.from({ length: 600 }, (_, row) => (
				<div key={row} className="flex gap-2 px-2 text-xs">
					<span>{row}</span>
					<span>
						{id} row {row}
					</span>
				</div>
			))}
		</div>
	);
}

const heavyPlugin = paneKindPlugin("perf.panes", [
	{
		id: "heavy",
		metadata: { title: "Heavy", launch: { inSession: true } },
		component: HeavyPane,
	},
]);

const COLUMNS = ["a", "b", "c"];
const KIND = "perf.panes/heavy";

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

function report(scenario: string, values: Record<string, number | string>) {
	console.log(`PERF ${JSON.stringify({ scenario, ...values })}`);
}

afterEach(() => {
	renders.clear();
	vi.unstubAllGlobals();
});

async function renderCanvas() {
	const panes = COLUMNS.map((id) => pane(id, KIND, { title: id }));
	const layout = createLayout(
		panes.map((entry) => descriptor({ id: entry.id, kind: "tool", title: entry.id })),
	);
	const rendered = await renderWorkSessions({
		workSessions: [SESSION],
		workspaces: [APP],
		activeWorkspaceId: APP.id,
		open: SESSION.id,
		panes: {
			[SESSION.id]: {
				...EMPTY_WORK_SESSION_PANES,
				panes,
				activePaneId: "a",
				layout: serializeLayout(layout),
			},
		},
		guests: [heavyPlugin],
	});
	for (const id of COLUMNS) await expect.element(page.getByTestId(`heavy-${id}`)).toBeVisible();
	// Let mount effects (portals, observers) settle before measuring.
	for (let index = 0; index < 10; index += 1) await frame();
	return rendered;
}

async function mouse(type: "mousePressed" | "mouseMoved" | "mouseReleased", x: number, y: number) {
	await cdp().send("Input.dispatchMouseEvent", {
		type,
		x,
		y,
		button: "left",
		buttons: type === "mouseReleased" ? 0 : 1,
		clickCount: 1,
	});
}

describe("pane canvas performance", () => {
	it("drags a column splitter", async () => {
		const { calls } = await renderCanvas();
		const handle = page.getByRole("separator", { name: "Resize column" }).first().element();
		const box = handle.getBoundingClientRect();
		const y = box.top + box.height / 2;
		let x = box.left + box.width / 2;
		const savesBefore = calls.setLayout.mock.calls.length;
		const rendersBefore = totalRenders();
		const MOVES = 60;
		const frames: number[] = [];

		const started = performance.now();
		await mouse("mousePressed", x, y);
		let last = await frame();
		for (let move = 0; move < MOVES; move += 1) {
			x += move < MOVES / 2 ? 2 : -1;
			await mouse("mouseMoved", x, y);
			const now = await frame();
			frames.push(now - last);
			last = now;
		}
		await mouse("mouseReleased", x, y);
		for (let index = 0; index < 5; index += 1) await frame();
		const total = performance.now() - started;
		await vi.waitFor(() => expect(calls.setLayout.mock.calls.length).toBeGreaterThan(savesBefore));
		frames.sort((left, right) => left - right);

		report("resize", {
			moves: MOVES,
			totalMs: Math.round(total),
			meanFrameMs: Number(
				(frames.reduce((sum, value) => sum + value, 0) / frames.length).toFixed(1),
			),
			p95FrameMs: Number(frames[Math.floor(frames.length * 0.95)]!.toFixed(1)),
			layoutSaves: calls.setLayout.mock.calls.length - savesBefore,
			paneRenders: totalRenders() - rendersBefore,
		});
	});

	it("moves the mouse without dragging (harness overhead)", async () => {
		await renderCanvas();
		const frames: number[] = [];
		let last = await frame();
		for (let move = 0; move < 60; move += 1) {
			await mouse("mouseMoved", 5 + move, 5);
			const now = await frame();
			frames.push(now - last);
			last = now;
		}
		report("control", {
			meanFrameMs: Number(
				(frames.reduce((sum, value) => sum + value, 0) / frames.length).toFixed(1),
			),
		});
	});

	it("switches the active pane", async () => {
		const { calls } = await renderCanvas();
		const savesBefore = calls.setLayout.mock.calls.length + calls.activatePane.mock.calls.length;
		const rendersBefore = totalRenders();
		const SWITCHES = 20;

		const started = performance.now();
		for (let index = 0; index < SWITCHES; index += 1) {
			const id = COLUMNS[(index + 1) % COLUMNS.length]!;
			const tab = page.getByTestId(`chat-pane-tab-${id}`).element() as HTMLElement;
			tab.click();
			const group = tab.closest('[data-qa-id^="chat-pane-group-"]');
			while (group?.getAttribute("data-group-active") !== "true") await frame();
		}
		const total = performance.now() - started;

		report("switch", {
			switches: SWITCHES,
			msPerSwitch: Number((total / SWITCHES).toFixed(1)),
			saves: calls.setLayout.mock.calls.length + calls.activatePane.mock.calls.length - savesBefore,
			paneRenders: totalRenders() - rendersBefore,
		});
	});
});
