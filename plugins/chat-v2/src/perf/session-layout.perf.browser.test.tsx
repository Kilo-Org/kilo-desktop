// Session layout benchmarks: kilo.work-sessions' real window (tab groups,
// splitters, the open work session) holding kilo.chat's real panes over long
// transcripts, as the app composes them. Each scenario logs one `PERF {…}`
// line; run with `pnpm --filter @kilo-desktop/plugin-chat-v2 perf`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp } from "vitest/browser";

import {
	createLayout,
	descriptor,
	movePaneToGroup,
	serializeLayout,
} from "@kilo-desktop/pane-layout";
import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	WorkSessionsWindow,
	type Pane,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { testWebEntry } from "@kilo-desktop/plugin-work-sessions/testing";

import { AGENT_PANE_KIND, chatPaneObject } from "../contracts";
import { agentPane, chatSummary, workSession } from "../test/chat-host";
import { FakeKiloServer } from "../test/fake-kilo-server";
import { longSession } from "../test/long-session";
import { renderChat } from "../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

const TURNS = 120;
/** How long the fake server takes to send a long chat's messages. */
const HISTORY_READ_DELAY_MS = 150;
const COLUMNS = 3;

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const report = (scenario: string, values: Record<string, number | string>) =>
	console.log(`PERF ${JSON.stringify({ scenario, ...values })}`);

function observeLongTasks() {
	let total = 0;
	const observer = new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) total += entry.duration;
	});
	observer.observe({ type: "longtask", buffered: false });
	return () => {
		observer.disconnect();
		return Math.round(total);
	};
}

async function settle() {
	let last = await frame();
	for (let quiet = 0; quiet < 3;) {
		const now = await frame();
		quiet = now - last < 34 ? quiet + 1 : 0;
		last = now;
	}
}

const chatIds = (session: string) =>
	Array.from({ length: COLUMNS }, (_, index) => `ses_${session}_${index}`);

function chatPanes(session: string): Pane[] {
	return chatIds(session).map((chatId, index) =>
		agentPane({
			id: `pane_${chatId}`,
			title: `Chat ${index}`,
			object: chatPaneObject(chatId),
			ordinal: index + 1,
		}),
	);
}

const sessionPanes = (session: string) => {
	const panes = chatPanes(session);
	let layout = createLayout(
		panes.map((pane) => descriptor({ id: pane.id, kind: "agent", title: pane.title })),
	);
	// The first two chats share a tab group; the third has a column of its own.
	layout = movePaneToGroup(layout, panes[1]!.id, layout.groups[0]!.id);
	return {
		...EMPTY_WORK_SESSION_PANES,
		panes,
		activePaneId: panes[0]!.id,
		layout: serializeLayout(layout),
	};
};

async function renderLayout() {
	const server = new FakeKiloServer();
	for (const session of ["a", "b", "c", "d"]) {
		for (const chatId of chatIds(session)) {
			server.addChat({
				id: chatId,
				directory: "/projects/app",
				title: chatId,
				messages: longSession(chatId, TURNS),
			});
		}
	}
	const started = performance.now();
	const stopTasks = observeLongTasks();
	const host = await renderChat({
		server,
		workSessionsWeb: testWebEntry,
		workSession: workSession({ id: "wses_a", chatIds: chatIds("a") }),
		otherWorkSessions: [
			workSession({ id: "wses_b", title: "Other", chatIds: chatIds("b") }),
			workSession({ id: "wses_c", title: "Cold", chatIds: chatIds("c") }),
			workSession({ id: "wses_d", title: "Hovered", chatIds: chatIds("d") }),
		],
		withoutPane: true,
		otherPanes: chatPanes("a"),
		layout: sessionPanes("a").layout,
		otherSessionPanes: {
			wses_b: sessionPanes("b"),
			wses_c: sessionPanes("c"),
			wses_d: sessionPanes("d"),
		},
		chats: [...chatIds("a"), ...chatIds("b")].map((id) => chatSummary(id)),
	});
	await waitForTranscripts("a");
	await settle();
	report("layout-open", {
		chats: COLUMNS,
		turnsEach: TURNS,
		visibleMs: Math.round(performance.now() - started),
		longTaskMs: stopTasks(),
		domNodes: document.querySelectorAll("*").length,
	});
	return { host, server };
}

/** The chats the session shows (one per tab group) show their last answer. */
const transcriptsShown = (session: string) =>
	[
		...document.querySelectorAll<HTMLElement>(
			`[data-session-id="wses_${session}"] [data-pane-group-id]`,
		),
	]
		.filter((group) => group.checkVisibility())
		.every((group) => group.textContent?.includes(`Final answer for turn ${TURNS}.`));

async function waitForTranscripts(session: string) {
	await expect
		.poll(
			() =>
				document.querySelectorAll(`[data-session-id="wses_${session}"] [data-pane-group-id]`)
					.length >= 2 && transcriptsShown(session),
			{
				timeout: 60_000,
				interval: 2,
			},
		)
		.toBe(true);
}

interface ProfileNode {
	id: number;
	callFrame: { functionName: string; url: string; lineNumber: number };
	hitCount?: number;
	children?: number[];
}

/** Under `pnpm perf:profile`, a CPU profile whose stop logs the kilo sources with the most total time. */
async function startProfile(): Promise<(label: string) => Promise<void>> {
	if (!import.meta.env.KILO_PERF_PROFILE) return async () => undefined;
	const session = cdp();
	await session.send("Profiler.enable");
	await session.send("Profiler.setSamplingInterval", { interval: 200 });
	await session.send("Profiler.start");
	return async (label) => {
		const { profile } = (await session.send("Profiler.stop")) as {
			profile: { nodes: ProfileNode[]; startTime: number; endTime: number; samples: number[] };
		};
		const ms = (profile.endTime - profile.startTime) / 1000 / profile.samples.length;
		const byId = new Map(profile.nodes.map((node) => [node.id, node]));
		const name = (node: ProfileNode) =>
			`${node.callFrame.functionName || "(anon)"} ${node.callFrame.url.split("/").pop()?.split("?")[0]}:${node.callFrame.lineNumber + 1}`;
		const total = new Map<string, number>();
		const self = new Map<string, number>();
		const visit = (node: ProfileNode, stack: Set<string>): number => {
			let hits = node.hitCount ?? 0;
			const key = name(node);
			self.set(key, (self.get(key) ?? 0) + hits);
			const next = new Set(stack).add(key);
			for (const child of node.children ?? []) hits += visit(byId.get(child)!, next);
			if (!stack.has(key)) total.set(key, (total.get(key) ?? 0) + hits);
			return hits;
		};
		visit(profile.nodes[0]!, new Set());
		const top = [...total]
			.filter(([key]) => /\.tsx?:\d+$/.test(key))
			.sort((a, b) => b[1] - a[1])
			.slice(0, 30)
			.map(([key, hits]) => `${(hits * ms).toFixed(0).padStart(6)}ms ${key}`);
		const selfTop = [...self]
			.filter(([key]) => !/^\((root|program|idle|garbage collector)\)/.test(key))
			.sort((a, b) => b[1] - a[1])
			.slice(0, 20)
			.map(([key, hits]) => `${(hits * ms).toFixed(0).padStart(6)}ms ${key}`);
		console.log(`PROFILE ${label} (kilo sources)\n${top.join("\n")}`);
		console.log(`PROFILE ${label} (self)\n${selfTop.join("\n")}`);
	};
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

describe("session layout performance", () => {
	it("opens, switches, resizes and adds tabs over long chats", async () => {
		const { host, server } = await renderLayout();
		const window = host.host.renderer.kernelSdk.domainObjects.get(WorkSessionsWindow)!;

		// Changing pages: to the other work session and back.
		// First visit to b mounts it; back to a and to b again find them kept.
		for (const [target, label] of [
			["wses_b", "b"],
			["wses_a", "a"],
			["wses_b", "b"],
		] as const) {
			const profile = await startProfile();
			const stop = observeLongTasks();
			const started = performance.now();
			await window.methods.openWorkSession({ workSessionId: target });
			await expect
				.poll(
					() => document.querySelector(`[data-qa-id="chat-pane-tab-pane_ses_${label}_0"]`) !== null,
					{ timeout: 60_000, interval: 2 },
				)
				.toBe(true);
			await waitForTranscripts(label);
			const shown = performance.now() - started;
			await settle();
			await profile(`page-change-${label}`);
			report("page-change", {
				to: label,
				shownMs: Math.round(shown),
				longTaskMs: stop(),
				domNodes: document.querySelectorAll("*").length,
			});
		}

		// Opening a session not opened before, from a server that takes a while
		// to send a long history: cold, and after resting the pointer on its row.
		server.historyReadDelayMs = HISTORY_READ_DELAY_MS;
		for (const [target, label, hover] of [
			["wses_c", "c", false],
			["wses_d", "d", true],
		] as const) {
			if (hover) {
				const row = [
					...document.querySelectorAll<HTMLElement>('[data-qa-id="session-list-item"]'),
				].find((item) => item.textContent?.includes("Hovered"))!;
				const box = row.getBoundingClientRect();
				await cdp().send("Input.dispatchMouseEvent", {
					type: "mouseMoved",
					x: box.left + box.width / 2,
					y: box.top + box.height / 2,
				});
				// The person reads the row until its chats have loaded, then clicks it.
				await expect
					.poll(() => chatIds(label).every((chatId) => server.messagePagesSent.includes(chatId)))
					.toBe(true);
			}
			const stop = observeLongTasks();
			const started = performance.now();
			await window.methods.openWorkSession({ workSessionId: target });
			await waitForTranscripts(label);
			report("open-new-session", {
				hovered: hover ? "yes" : "no",
				serverDelayMs: HISTORY_READ_DELAY_MS,
				shownMs: Math.round(performance.now() - started),
				longTaskMs: stop(),
			});
			await settle();
		}
		server.historyReadDelayMs = 0;

		// Switching tabs in a tab group of two long chats.
		{
			await window.methods.openWorkSession({ workSessionId: "wses_a" });
			await waitForTranscripts("a");
			await settle();
			const tabs = ["pane_ses_a_1", "pane_ses_a_0"];
			const stop = observeLongTasks();
			const started = performance.now();
			for (let index = 0; index < 10; index += 1) {
				const id = tabs[index % 2]!;
				document.querySelector<HTMLElement>(`[data-qa-id="chat-pane-tab-${id}"]`)!.click();
				await expect
					.poll(
						() =>
							document
								.querySelector(`[data-pane-id="${id}"]`)
								?.textContent?.includes(`Final answer for turn ${TURNS}.`) ?? false,
						{ timeout: 30_000, interval: 1 },
					)
					.toBe(true);
				await frame();
			}
			report("tab-switch", {
				switches: 10,
				msPerSwitch: Number(((performance.now() - started) / 10).toFixed(1)),
				longTaskMs: stop(),
			});
		}

		// Harness cost: the same mouse moves with no drag.
		{
			const frames: number[] = [];
			let last = await frame();
			for (let move = 0; move < 60; move += 1) {
				await mouse("mouseMoved", 20 + move, 20);
				const now = await frame();
				frames.push(now - last);
				last = now;
			}
			report("resize-control", {
				meanFrameMs: Number(
					(frames.reduce((sum, value) => sum + value, 0) / frames.length).toFixed(1),
				),
			});
		}

		// Resizing a tab group: drag the first column splitter.
		{
			const handle = document.querySelector<HTMLElement>(
				'[role="separator"][aria-label="Resize column"]',
			)!;
			const box = handle.getBoundingClientRect();
			const y = box.top + box.height / 2;
			let x = box.left + box.width / 2;
			const saves = host.workSessions.calls.setLayout.mock.calls.length;
			const stop = observeLongTasks();
			const frames: number[] = [];
			const profileDrag = await startProfile();
			await mouse("mousePressed", x, y);
			let last = await frame();
			for (let move = 0; move < 60; move += 1) {
				x += move < 30 ? 3 : -2;
				await mouse("mouseMoved", x, y);
				const now = await frame();
				frames.push(now - last);
				last = now;
			}
			await mouse("mouseReleased", x, y);
			await profileDrag("resize");
			await settle();
			// The canvas saves once the drag rests.
			await vi.waitFor(() =>
				expect(host.workSessions.calls.setLayout.mock.calls.length).toBeGreaterThan(saves),
			);
			frames.sort((a, b) => a - b);
			report("resize", {
				meanFrameMs: Number(
					(frames.reduce((sum, value) => sum + value, 0) / frames.length).toFixed(1),
				),
				p95FrameMs: Number(frames[Math.floor(frames.length * 0.95)]!.toFixed(1)),
				maxFrameMs: Number(frames.at(-1)!.toFixed(1)),
				longTaskMs: stop(),
				layoutSaves: host.workSessions.calls.setLayout.mock.calls.length - saves,
			});
		}

		// Adding a tab: a new chat pane into the session.
		{
			const stop = observeLongTasks();
			const started = performance.now();
			const panes = host.host.renderer.kernelSdk.domainObjects.get(Panes)!;
			await panes.methods.open({
				workSessionId: window.getState().activeWorkSessionId!,
				kind: AGENT_PANE_KIND,
			});
			await expect
				.poll(() => document.querySelectorAll('[data-qa-id="kilo-chat-thread"]').length > COLUMNS, {
					timeout: 30_000,
					interval: 2,
				})
				.toBe(true);
			const shown = performance.now() - started;
			await settle();
			report("add-tab", { shownMs: Math.round(shown), longTaskMs: stop() });
		}
	});
});
