import { describe, expect, it, vi } from "vitest";

import { ReadingFocusController, type FocusSource } from "./focus-controller";

type Target = { kind: "doc"; block: number };

function source(paneId: string, reveal = vi.fn()): FocusSource<Target> {
	return {
		workSessionId: "ws1",
		paneId,
		kind: "doc",
		available: () => true,
		targetNearMiddle: () => ({ kind: "doc", block: 2 }),
		reveal,
		entryContext: () => ({ blockCount: 3, streaming: false }),
	};
}

describe("ReadingFocusController", () => {
	it("opens the take-over on enter and ends the session, with its exit reason, when it unmounts", async () => {
		const focus = new ReadingFocusController<Target>();
		const opened = vi.fn(async () => {});
		const closed = vi.fn(async () => {});
		const ended = vi.fn();
		focus.openTakeover = opened;
		focus.closeTakeover = closed;
		focus.onEnded = ended;
		focus.register(source("p1"));

		await focus.enter({ workSessionId: "ws1", paneId: "p1" }, { kind: "doc", block: 1 }, "rail");
		const session = focus.session()!;
		focus.focusedBlock(3);
		await focus.exit("escape");
		await focus.exit("exit-button");
		focus.ended(session.id);

		expect(opened).toHaveBeenCalledWith(session);
		expect(closed).toHaveBeenCalledTimes(2);
		expect(ended).toHaveBeenCalledWith(session, "escape", 3);
		expect(focus.session()).toBeNull();
	});

	it("keeps a held session through an immediate release and re-hold (a StrictMode remount), ending it once released for good", async () => {
		const focus = new ReadingFocusController<Target>();
		const ended = vi.fn();
		focus.onEnded = ended;
		focus.register(source("p1"));
		await focus.enter({ workSessionId: "ws1", paneId: "p1" }, { kind: "doc", block: 0 }, "rail");
		const { id } = focus.session()!;

		focus.hold(id)();
		const release = focus.hold(id);
		await Promise.resolve();
		expect(focus.session()?.id).toBe(id);
		expect(ended).not.toHaveBeenCalled();

		release();
		release();
		await Promise.resolve();
		expect(focus.session()).toBeNull();
		expect(ended).toHaveBeenCalledTimes(1);
	});

	it("does not let a stale take-over's release end a newer session", async () => {
		const focus = new ReadingFocusController<Target>();
		focus.register(source("p1"));
		const pane = { workSessionId: "ws1", paneId: "p1" };
		await focus.enter(pane, { kind: "doc", block: 0 }, "rail");
		const releaseOld = focus.hold(focus.session()!.id);
		await focus.enter(pane, { kind: "doc", block: 1 }, "rail");
		const current = focus.session()!.id;
		focus.hold(current);

		releaseOld();
		await Promise.resolve();

		expect(focus.session()?.id).toBe(current);
	});

	it("takes the pane back to the last focused block after leaving", async () => {
		const reveal = vi.fn();
		const focus = new ReadingFocusController<Target>();
		focus.register(source("p1", reveal));
		await focus.enter(
			{ workSessionId: "ws1", paneId: "p1" },
			{ kind: "doc", block: 0 },
			"shortcut",
		);
		const { id } = focus.session()!;
		focus.focusedBlock(4);

		focus.ended(id);
		await new Promise((resolve) => requestAnimationFrame(resolve));

		expect(reveal).toHaveBeenCalledWith({ kind: "doc", block: 4 });
	});

	it("takes the pane back to the target reading stopped on, when Focus shows more than the entered one", async () => {
		const reveal = vi.fn();
		const ended = vi.fn();
		const focus = new ReadingFocusController<Target>();
		focus.onEnded = ended;
		focus.register(source("p1", reveal));
		await focus.enter({ workSessionId: "ws1", paneId: "p1" }, { kind: "doc", block: 1 }, "rail");
		const { id } = focus.session()!;
		focus.focusedBlock(7, { kind: "doc", block: 0 });

		focus.ended(id);
		await new Promise((resolve) => requestAnimationFrame(resolve));

		expect(reveal).toHaveBeenCalledWith({ kind: "doc", block: 0 });
		expect(ended).toHaveBeenCalledWith(expect.anything(), "other", 7);
	});

	it("exits when the source pane goes away, and ignores a stale take-over", async () => {
		const focus = new ReadingFocusController<Target>();
		const closed = vi.fn(async () => {});
		const ended = vi.fn();
		focus.closeTakeover = closed;
		focus.onEnded = ended;
		const unregister = focus.register(source("p1"));
		await focus.enter({ workSessionId: "ws1", paneId: "p1" }, { kind: "doc", block: 0 }, "rail");
		const { id } = focus.session()!;

		unregister();
		focus.ended(id + 1);
		expect(closed).toHaveBeenCalled();
		expect(focus.session()).not.toBeNull();
		focus.ended(id);

		expect(ended).toHaveBeenCalledWith(expect.anything(), "pane-closed", 0);
		expect(focus.source("p1")).toBeUndefined();
	});

	it("notifies subscribers, keeps the take-over's container and ignores exits without a session", async () => {
		const focus = new ReadingFocusController<Target>();
		const closed = vi.fn(async () => {});
		focus.closeTakeover = closed;
		const seen: unknown[] = [];
		const stop = focus.subscribe(() => seen.push(focus.container()));

		await focus.exit("escape");
		const container = document.createElement("div");
		focus.setContainer(container);
		focus.setContainer(container);
		focus.changed();
		stop();
		focus.setContainer(null);

		expect(closed).not.toHaveBeenCalled();
		expect(seen).toEqual([container, container]);
		expect(focus.container()).toBeNull();
	});
});
