// Chat performance benchmarks (run with `pnpm --filter @kilo-desktop/plugin-chat-v2 perf`):
// opening a long session, streaming a reply into it and scrolling through
// it, in a real kernel with kilo.chat's real entries over a FakeKiloServer.
// Each scenario logs one `PERF {…}` line; compare them before and after a
// change. Numbers are wall-clock in headless Chromium, so compare runs on the
// same machine and look at the trend across sizes, not single digits.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, page } from "vitest/browser";

import { chatPaneObject } from "../contracts";
import { agentPane, chatSummary } from "../test/chat-host";
import { assistantMessage, FakeKiloServer, userMessage } from "../test/fake-kilo-server";
import { longSession } from "../test/long-session";
import { renderChat } from "../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

const SIZES = [40, 160, 400];
const DELTAS = 300;
const SCROLL_STEPS = 40;

interface LongTasks {
	total(): number;
	count(): number;
	stop(): void;
}

function observeLongTasks(): LongTasks {
	let total = 0;
	let count = 0;
	const observer = new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			total += entry.duration;
			count += 1;
		}
	});
	observer.observe({ type: "longtask", buffered: false });
	return {
		total: () => Math.round(total),
		count: () => count,
		stop: () => observer.disconnect(),
	};
}

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface ProfileNode {
	id: number;
	callFrame: { functionName: string; url: string; lineNumber: number };
	hitCount?: number;
	children?: number[];
}

/**
 * Under `pnpm perf:profile` (KILO_PERF_PROFILE=1), wraps
 * `run` in a CPU profile and logs the functions with the most self and
 * total time, so a regression points at its cause.
 */
async function profiled<T>(label: string, run: () => Promise<T>): Promise<T> {
	if (!import.meta.env.KILO_PERF_PROFILE) return run();
	const session = cdp();
	await session.send("Profiler.enable");
	await session.send("Profiler.setSamplingInterval", { interval: 200 });
	await session.send("Profiler.start");
	const result = await run();
	const { profile } = (await session.send("Profiler.stop")) as {
		profile: { nodes: ProfileNode[]; startTime: number; endTime: number; samples: number[] };
	};
	const msPerSample = (profile.endTime - profile.startTime) / 1000 / profile.samples.length;
	const byId = new Map(profile.nodes.map((node) => [node.id, node]));
	const name = (node: ProfileNode) => {
		const file = node.callFrame.url.split("/").pop()?.split("?")[0] ?? "";
		return `${node.callFrame.functionName || "(anon)"} ${file}:${node.callFrame.lineNumber + 1}`;
	};
	const self = new Map<string, number>();
	const total = new Map<string, number>();
	const visit = (node: ProfileNode, onStack: Set<string>): number => {
		let hits = node.hitCount ?? 0;
		const key = name(node);
		self.set(key, (self.get(key) ?? 0) + (node.hitCount ?? 0));
		const nested = new Set(onStack).add(key);
		for (const child of node.children ?? []) hits += visit(byId.get(child)!, nested);
		if (!onStack.has(key)) total.set(key, (total.get(key) ?? 0) + hits);
		return hits;
	};
	visit(profile.nodes[0]!, new Set());
	const top = (map: Map<string, number>) =>
		[...map]
			.filter(([key]) => !/^\((root|program|idle|garbage collector)\)/.test(key))
			.sort((a, b) => b[1] - a[1])
			.slice(0, 25)
			.map(([key, hits]) => `${(hits * msPerSample).toFixed(0).padStart(6)}ms ${key}`);
	const ours = new Map([...total].filter(([key]) => /\.tsx?:\d+$/.test(key)));
	console.log(`PROFILE ${label} self\n${top(self).join("\n")}`);
	console.log(`PROFILE ${label} total (kilo sources)\n${top(ours).join("\n")}`);
	return result;
}

function report(scenario: string, values: Record<string, number | string>) {
	console.log(`PERF ${JSON.stringify({ scenario, ...values })}`);
}

async function openLongSession(turns: number) {
	const server = new FakeKiloServer();
	server.addChat({
		id: "ses_a",
		directory: "/projects/app",
		title: "Long chat",
		messages: longSession("ses_a", turns),
	});
	const tasks = observeLongTasks();
	const started = performance.now();
	const host = await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
	});
	await expect
		.element(page.getByText(`Final answer for turn ${turns}.`), { timeout: 60_000 })
		.toBeInTheDocument();
	const visible = performance.now() - started;
	// The conversation map shows once the whole history is in.
	await expect
		.poll(() => document.querySelector('[data-slot="conversation-map-rail"]') !== null, {
			timeout: 60_000,
			interval: 1,
		})
		.toBe(true);
	const complete = performance.now() - started;
	// Settled: two quiet frames in a row after the last message shows.
	let last = await frame();
	for (let quiet = 0; quiet < 2;) {
		const now = await frame();
		quiet = now - last < 34 ? quiet + 1 : 0;
		last = now;
	}
	const settled = performance.now() - started;
	tasks.stop();
	report("open", {
		turns,
		messages: turns * 2,
		visibleMs: Math.round(visible),
		completeMs: Math.round(complete),
		settledMs: Math.round(settled),
		longTaskMs: tasks.total(),
		domNodes: document.querySelectorAll("*").length,
	});
	await vi.waitFor(() => expect(server.openStreams).toBeGreaterThan(0));
	return { host, server };
}

async function streamReply(server: FakeKiloServer, turns: number) {
	const replyStarted = performance.now();
	server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
	// Stamped on the fixtures' clock, so the reply sorts after the session's last turn.
	const user = userMessage("ses_a", "msg_live_u", "Go on");
	const reply = assistantMessage("ses_a", "msg_live_a", user.info.id, []);
	const { completed: _completed, ...replyTime } = reply.info.time as {
		created: number;
		completed?: number;
	};
	server.emit("message.updated", { info: user.info });
	for (const part of user.parts) server.emit("message.part.updated", { part });
	server.emit("message.updated", { info: { ...reply.info, time: replyTime, finish: undefined } });
	server.emit("message.part.updated", {
		part: {
			id: "part_live",
			sessionID: "ses_a",
			messageID: "msg_live_a",
			type: "text",
			text: "Streaming",
			time: { start: replyTime.created },
		},
	});
	await expect
		.poll(() => document.body.textContent?.includes("Streaming"), { timeout: 30_000, interval: 1 })
		.toBe(true);
	const firstTextMs = Math.round(performance.now() - replyStarted);

	const tasks = observeLongTasks();
	const started = performance.now();
	await profiled(`stream-${turns}`, async () => {
		for (let index = 0; index < DELTAS; index += 1) {
			emitDelta(server, index, "STREAM_DONE");
			await macrotask();
		}
	});
	const emitted = performance.now() - started;
	await expect
		.poll(() => document.body.textContent?.includes("STREAM_DONE"), {
			timeout: 60_000,
			interval: 5,
		})
		.toBe(true);
	const done = performance.now() - started;
	tasks.stop();
	report("stream", {
		turns,
		deltas: DELTAS,
		firstTextMs,
		emitMs: Math.round(emitted),
		doneMs: Math.round(done),
		msPerDelta: Number((done / DELTAS).toFixed(2)),
		longTaskMs: tasks.total(),
		longTasks: tasks.count(),
	});
	await streamBursts(server, turns);
	server.emit("session.idle", { sessionID: "ses_a" });
}

const emitDelta = (server: FakeKiloServer, index: number, last: string) =>
	server.emit("message.part.delta", {
		sessionID: "ses_a",
		messageID: "msg_live_a",
		partID: "part_live",
		field: "text",
		delta:
			index === DELTAS - 1
				? ` ${last}`
				: index % 40 === 39
					? "\n\nNext paragraph"
					: ` word${index}`,
	});

/** Tokens arriving in bursts, several to a network read, as a fast model sends them. */
const BURST = 20;

/** Main-thread busy time so far, from Chromium's own task accounting. */
async function mainThreadMs(): Promise<number> {
	const session = cdp();
	await session.send("Performance.enable");
	const { metrics } = (await session.send("Performance.getMetrics")) as {
		metrics: { name: string; value: number }[];
	};
	return (metrics.find((metric) => metric.name === "TaskDuration")?.value ?? 0) * 1000;
}

async function streamBursts(server: FakeKiloServer, turns: number) {
	const busyBefore = await mainThreadMs();
	const tasks = observeLongTasks();
	const started = performance.now();
	await profiled(`burst-${turns}`, async () => {
		for (let index = 0; index < DELTAS; index += 1) {
			emitDelta(server, index, "BURST_DONE");
			if (index % BURST === BURST - 1) await new Promise((resolve) => setTimeout(resolve, 16));
		}
		await expect
			.poll(() => document.body.textContent?.includes("BURST_DONE"), {
				timeout: 60_000,
				interval: 5,
			})
			.toBe(true);
	});
	const done = performance.now() - started;
	const busy = (await mainThreadMs()) - busyBefore;
	tasks.stop();
	report("burst", {
		turns,
		deltas: DELTAS,
		perRead: BURST,
		doneMs: Math.round(done),
		idealMs: Math.round((DELTAS / BURST) * 16),
		mainThreadMs: Math.round(busy),
		longTaskMs: tasks.total(),
		longTasks: tasks.count(),
	});
}

async function scrollToTop(turns: number) {
	const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')!;
	viewport.style.scrollBehavior = "auto";
	await frame();
	const tasks = observeLongTasks();
	const frames: number[] = [];
	const height = viewport.scrollHeight;
	let last = await frame();
	for (let step = 1; step <= SCROLL_STEPS; step += 1) {
		viewport.scrollTop = height - (height * step) / SCROLL_STEPS - viewport.clientHeight;
		const now = await frame();
		frames.push(now - last);
		last = now;
	}
	tasks.stop();
	frames.sort((a, b) => a - b);
	report("scroll", {
		turns,
		steps: SCROLL_STEPS,
		meanFrameMs: Number((frames.reduce((sum, value) => sum + value, 0) / frames.length).toFixed(1)),
		p95FrameMs: Number(frames[Math.floor(frames.length * 0.95)]!.toFixed(1)),
		maxFrameMs: Number(frames.at(-1)!.toFixed(1)),
		longTaskMs: tasks.total(),
	});
}

/** Jumps from the bottom to the first turn, as the conversation map or a fast scroll does. */
async function jumpToOldest(turns: number) {
	const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')!;
	viewport.scrollTop = viewport.scrollHeight;
	for (let index = 0; index < 5; index += 1) await frame();
	const tasks = observeLongTasks();
	const started = performance.now();
	viewport.scrollTop = 0;
	await expect
		.poll(() => document.body.textContent?.includes("Final answer for turn 1."), {
			timeout: 30_000,
			interval: 1,
		})
		.toBe(true);
	await frame();
	await frame();
	const shown = performance.now() - started;
	tasks.stop();
	report("oldest", {
		turns,
		shownMs: Math.round(shown),
		longTaskMs: tasks.total(),
		domNodes: document.querySelectorAll("*").length,
	});
}

describe("chat performance", () => {
	for (const turns of SIZES) {
		it(`opens, streams into and scrolls a ${turns}-turn session`, async () => {
			const { server } = await openLongSession(turns);
			await streamReply(server, turns);
			await scrollToTop(turns);
			await jumpToOldest(turns);
		});
	}
});
