import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import {
	normalizeEventPayload,
	OpenCodeEventSource,
	sessionIdOfEvent,
	STREAM_RECONNECTED_EVENT_TYPE,
} from "./OpenCodeEventSource";
import type { OpenCodeServerEvent } from "./types";

/** A stream yielding `frames`, then held open until `signal` aborts unless `end`. */
function streamOf(frames: readonly unknown[], signal: AbortSignal, { end = false } = {}) {
	return (async function* () {
		yield* frames;
		if (end) return;
		await new Promise<void>((resolve) => {
			if (signal.aborted) resolve();
			else signal.addEventListener("abort", () => resolve(), { once: true });
		});
	})();
}

const connected = { type: "server.connected", id: "evt_c", created: 1, data: {} };

const types = (listener: ReturnType<typeof vi.fn>) =>
	listener.mock.calls.map(([event]) => (event as OpenCodeServerEvent).type);

afterEach(() => {
	vi.useRealTimers();
});

describe("normalizeEventPayload", () => {
	it("keeps a v2 frame's fields and names the session it is about", () => {
		expect(
			normalizeEventPayload({
				id: "evt_1",
				created: 5,
				type: "session.renamed",
				location: { directory: "/projects/app" },
				metadata: { origin: "tui" },
				data: { sessionID: "ses_1", title: "Fix" },
				durable: { seq: 1 },
			}),
		).toEqual({
			id: "evt_1",
			created: 5,
			type: "session.renamed",
			location: { directory: "/projects/app" },
			metadata: { origin: "tui" },
			data: { sessionID: "ses_1", title: "Fix" },
			sessionId: "ses_1",
		});
	});

	it("reads a form event's session from its form", () => {
		expect(sessionIdOfEvent({ form: { id: "frm_1", sessionID: "ses_2" } })).toBe("ses_2");
		expect(normalizeEventPayload({ type: "server.connected" })).toEqual({
			type: "server.connected",
			data: {},
			sessionId: undefined,
		});
	});

	it("drops what isn't a frame", () => {
		expect(normalizeEventPayload("ping")).toBeNull();
		expect(normalizeEventPayload({ data: {} })).toBeNull();
	});
});

describe("OpenCodeEventSource", () => {
	it("opens the client's event stream with an abort signal, and aborts it when the last listener leaves", async () => {
		const signals: AbortSignal[] = [];
		const client = {
			event: {
				subscribe: vi.fn(({ signal }: { signal: AbortSignal }) => {
					signals.push(signal);
					return streamOf([], signal);
				}),
			},
		};
		const source = new OpenCodeEventSource(client as never);

		const unsubscribe = source.subscribe(vi.fn());
		await vi.waitFor(() => expect(client.event.subscribe).toHaveBeenCalledOnce());
		unsubscribe();

		expect(signals[0]?.aborted).toBe(true);
	});

	it("delivers normalized frames, announcing a reconnect after server.connected", async () => {
		const source = new OpenCodeEventSource({} as never, ({ signal }) => ({
			stream: streamOf(
				[
					connected,
					"garbage",
					{ type: "session.renamed", id: "evt_2", data: { sessionID: "ses_1", title: "x" } },
				],
				signal,
			),
		}));
		const listener = vi.fn();

		source.subscribe(listener);

		await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(3));
		expect(types(listener)).toEqual([
			"server.connected",
			STREAM_RECONNECTED_EVENT_TYPE,
			"session.renamed",
		]);
		expect(listener.mock.calls[2]?.[0]).toMatchObject({ id: "evt_2", sessionId: "ses_1" });
		source.dispose();
	});

	it("reconnects when the stream ends, announcing every reconnect", async () => {
		vi.useFakeTimers();
		const subscribe = vi.fn(({ signal }: { signal: AbortSignal }) => ({
			stream: streamOf([connected], signal, { end: subscribe.mock.calls.length === 1 }),
		}));
		const source = new OpenCodeEventSource({} as never, subscribe);
		const listener = vi.fn();

		source.subscribe(listener);
		await vi.waitFor(() => expect(types(listener)).toContain(STREAM_RECONNECTED_EVENT_TYPE));
		await vi.advanceTimersByTimeAsync(1_000);

		await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
		await vi.waitFor(() =>
			expect(types(listener).filter((type) => type === STREAM_RECONNECTED_EVENT_TYPE)).toHaveLength(
				2,
			),
		);
		source.dispose();
	});

	it("retries a failed connection", async () => {
		vi.useFakeTimers();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		onTestFinished(() => warn.mockRestore());
		const subscribe = vi
			.fn<(options: { signal: AbortSignal }) => Promise<{ stream: AsyncIterable<unknown> }>>()
			.mockRejectedValueOnce(new Error("ECONNREFUSED"))
			.mockImplementation(async ({ signal }) => ({ stream: streamOf([connected], signal) }));
		const source = new OpenCodeEventSource({} as never, subscribe);
		const listener = vi.fn();

		source.subscribe(listener);
		await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
		await vi.advanceTimersByTimeAsync(1_000);

		await vi.waitFor(() => expect(types(listener)).toContain(STREAM_RECONNECTED_EVENT_TYPE));
		expect(subscribe).toHaveBeenCalledTimes(2);
		expect(warn).toHaveBeenCalled();
		source.dispose();
	});

	it("connects again at once when a listener returns after the last one left", async () => {
		const subscribe = vi.fn(({ signal }: { signal: AbortSignal }) => ({
			stream: streamOf([connected], signal),
		}));
		const source = new OpenCodeEventSource({} as never, subscribe);

		const unsubscribe = source.subscribe(vi.fn());
		await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
		unsubscribe();
		const returning = vi.fn();
		source.subscribe(returning);

		await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
		await vi.waitFor(() => expect(types(returning)).toContain(STREAM_RECONNECTED_EVENT_TYPE));
		source.dispose();
	});

	it("hands every frame to its observer before its listeners", async () => {
		const onEvent = vi.fn();
		const source = new OpenCodeEventSource(
			{} as never,
			({ signal }) => ({ stream: streamOf([connected], signal) }),
			onEvent,
		);

		source.subscribe(vi.fn());

		await vi.waitFor(() =>
			expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "server.connected" })),
		);
		source.dispose();
	});

	it("keeps notifying listeners when one throws", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		onTestFinished(() => error.mockRestore());
		const source = new OpenCodeEventSource({} as never, ({ signal }) => ({
			stream: streamOf([connected], signal),
		}));
		const listener = vi.fn();

		source.subscribe(() => {
			throw new Error("boom");
		});
		source.subscribe(listener);

		await vi.waitFor(() =>
			expect(types(listener)).toEqual(["server.connected", STREAM_RECONNECTED_EVENT_TYPE]),
		);
		expect(error).toHaveBeenCalledWith(
			"[react-opencode] Listener threw an error",
			expect.any(Error),
		);
		source.dispose();
	});

	it("stays closed once disposed", async () => {
		const subscribe = vi.fn(({ signal }: { signal: AbortSignal }) => ({
			stream: streamOf([], signal),
		}));
		const source = new OpenCodeEventSource({} as never, subscribe);
		source.subscribe(vi.fn());
		await vi.waitFor(() => expect(subscribe).toHaveBeenCalledOnce());

		source.dispose();
		source.subscribe(vi.fn());

		expect(subscribe).toHaveBeenCalledOnce();
	});
});
