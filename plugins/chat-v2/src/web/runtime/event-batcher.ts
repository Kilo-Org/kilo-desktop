import type { OpenCodeEvent, OpenCodeServerEvent } from "@kilo-desktop/react-opencode-v2";

/*
 * Delivers the window's streamed tokens in batches, at most one per frame.
 * A model streams 50–150 tokens a second and a network read often carries
 * several; delivered one by one, each token ran a chat's reducer, its
 * projection and a store notification. Here a frame's run of deltas to the
 * same item is joined into one delta, so the reducer runs once.
 *
 * - Only Kilo v2's deltas (`session.text.delta`, `session.reasoning.delta`,
 *   `session.tool.input.delta`) wait. Every other event (connects, resyncs,
 *   status, whole parts) first delivers what's queued, then itself, at once:
 *   their timing against history loads is what react-opencode relies on (a
 *   resync arriving after a thread's first load would load it again).
 * - Order is kept: a delta joins only the event queued just before it, and
 *   only when that is a delta of the same kind to the same step and item.
 * - The flush is a timer, not an animation frame: a hidden window gets no
 *   frames, and its queue would grow without bound.
 * - Each listener gets exactly the events it would have got one by one: the
 *   queue is delivered before a listener joins or leaves, so one joining
 *   never sees events from before it subscribed (a chat that has just loaded
 *   its history would apply them twice) and one leaving gets what was queued
 *   while it listened.
 * - A listener that throws doesn't keep the batch from the others.
 */

type Listener = (event: OpenCodeServerEvent) => void;

export const EVENT_BATCH_INTERVAL_MS = 16;

type KiloEvent = Extract<OpenCodeServerEvent, { type: "kilo.event" }>;
type DeltaEvent = Extract<
	OpenCodeEvent,
	{ type: "session.text.delta" | "session.reasoning.delta" | "session.tool.input.delta" }
>;

/** Kilo v2's streaming deltas: a step's text and reasoning, and a tool call's input. */
const isDelta = (event: OpenCodeServerEvent): event is KiloEvent & { event: DeltaEvent } =>
	event.type === "kilo.event" &&
	(event.event.type === "session.text.delta" ||
		event.event.type === "session.reasoning.delta" ||
		event.event.type === "session.tool.input.delta");

/** What a delta extends: its event type, session, step and item (ordinal or tool call id). */
const deltaTarget = ({ event, sessionId }: KiloEvent & { event: DeltaEvent }): string => {
	const item = event.type === "session.tool.input.delta" ? event.data.id : event.data.ordinal;
	return `${event.type}:${sessionId}:${event.data.assistantMessageID}:${item}`;
};

function joinDeltas(
	previous: OpenCodeServerEvent,
	next: OpenCodeServerEvent,
): OpenCodeServerEvent | null {
	if (!isDelta(previous) || !isDelta(next) || deltaTarget(previous) !== deltaTarget(next)) {
		return null;
	}
	const event = {
		...previous.event,
		data: { ...previous.event.data, delta: previous.event.data.delta + next.event.data.delta },
	} as DeltaEvent;
	return { ...previous, event };
}

export interface EventBatcher {
	/** Queues `event` for the next batch. */
	push(event: OpenCodeServerEvent): void;
	subscribe(listener: Listener): () => void;
	/** Delivers what's queued now (for teardown and tests). */
	flush(): void;
	dispose(): void;
}

export function createEventBatcher(intervalMs = EVENT_BATCH_INTERVAL_MS): EventBatcher {
	const listeners = new Set<Listener>();
	let queue: OpenCodeServerEvent[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;

	const flush = () => {
		clearTimeout(timer);
		timer = undefined;
		const batch = queue;
		queue = [];
		for (const event of batch) {
			for (const listener of listeners) {
				try {
					listener(event);
				} catch (error) {
					console.error("[kilo.chat] An event listener threw", error);
				}
			}
		}
	};

	return {
		push(event) {
			if (!isDelta(event)) {
				queue.push(event);
				flush();
				return;
			}
			const last = queue.at(-1);
			const joined = last ? joinDeltas(last, event) : null;
			if (joined) queue[queue.length - 1] = joined;
			else queue.push(event);
			timer ??= setTimeout(flush, intervalMs);
		},
		subscribe(listener) {
			flush();
			listeners.add(listener);
			return () => {
				flush();
				listeners.delete(listener);
			};
		},
		flush,
		dispose() {
			clearTimeout(timer);
			timer = undefined;
			queue = [];
			listeners.clear();
		},
	};
}
