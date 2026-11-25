import { describe, it, expect, vi } from "vitest";
import { OpenCodeEventSource, STREAM_RECONNECTED_EVENT_TYPE } from "./OpenCodeEventSource";

const waitFor = async (assertion: () => void) => {
	let lastError: unknown;

	for (let i = 0; i < 20; i++) {
		try {
			assertion();
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}

	throw lastError;
};

const createAbortableStream = (signal: AbortSignal) =>
	// An event stream that never yields and ends when aborted.
	// oxlint-disable-next-line require-yield
	(async function* () {
		await new Promise<void>((resolve) => {
			if (signal.aborted) {
				resolve();
				return;
			}

			signal.addEventListener("abort", () => resolve(), { once: true });
		});
	})();

describe("OpenCodeEventSource", () => {
	it("reconnects immediately when a listener returns after disconnect", async () => {
		const subscribe = vi.fn((options: { signal: AbortSignal; sseMaxRetryAttempts: number }) =>
			Promise.resolve({
				stream: createAbortableStream(options.signal),
			}),
		);
		const source = new OpenCodeEventSource(subscribe);

		const unsubscribe = source.subscribe(vi.fn());

		await waitFor(() => {
			expect(subscribe).toHaveBeenCalledTimes(1);
		});
		expect(subscribe).toHaveBeenLastCalledWith({
			signal: expect.any(AbortSignal),
			sseMaxRetryAttempts: 1,
		});

		unsubscribe();
		source.subscribe(vi.fn());

		await waitFor(() => {
			expect(subscribe).toHaveBeenCalledTimes(2);
		});
	});

	it("notifies listeners on reconnect but not on the first connection", async () => {
		const subscribe = vi.fn((options: { signal: AbortSignal; sseMaxRetryAttempts: number }) =>
			Promise.resolve({
				stream: createAbortableStream(options.signal),
			}),
		);
		const source = new OpenCodeEventSource(subscribe);

		const firstListener = vi.fn();
		const unsubscribe = source.subscribe(firstListener);

		await waitFor(() => {
			expect(subscribe).toHaveBeenCalledTimes(1);
		});
		expect(firstListener).not.toHaveBeenCalled();

		unsubscribe();
		const secondListener = vi.fn();
		source.subscribe(secondListener);

		await waitFor(() => {
			expect(secondListener).toHaveBeenCalledWith(
				expect.objectContaining({ type: STREAM_RECONNECTED_EVENT_TYPE }),
			);
		});
		expect(secondListener).toHaveBeenCalledTimes(1);
	});

	it("finds the session of a Kilo v2 form", async () => {
		const subscribe = vi.fn(async () => ({
			stream: (async function* () {
				yield {
					id: "evt_1",
					type: "form.created",
					data: { form: { id: "frm_1", sessionID: "ses_1" } },
					location: { directory: "/w" },
				};
			})(),
		}));
		const source = new OpenCodeEventSource(subscribe);
		const listener = vi.fn();
		const unsubscribe = source.subscribe(listener);

		await waitFor(() => {
			expect(listener).toHaveBeenCalledWith({
				type: "kilo.event",
				event: expect.objectContaining({ id: "evt_1", type: "form.created" }),
				sessionId: "ses_1",
				directory: "/w",
			});
		});
		unsubscribe();
		source.dispose();
	});

	it("continues notifying listeners when one throws", () => {
		// Reaches into the private listener set to make one listener throw.
		// oxlint-disable-next-line typescript/no-explicit-any
		const source = new OpenCodeEventSource(vi.fn()) as any;
		const listener = vi.fn();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		source.listeners.add(() => {
			throw new Error("boom");
		});
		source.listeners.add(listener);

		source.emit({ type: STREAM_RECONNECTED_EVENT_TYPE });

		expect(listener).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledTimes(1);

		errorSpy.mockRestore();
	});
});
