import type { OpenCodeClient } from "@kilocode/client";
import { describe, expect, it, vi } from "vitest";

import { createDeferredKiloClient } from "./deferred-client";

const deferred = (client: object) =>
	createDeferredKiloClient(async () => client as unknown as OpenCodeClient);

describe("createDeferredKiloClient", () => {
	it("calls the client it resolves, with its own receiver", async () => {
		const session = {
			name: "session",
			get(this: { name: string }, args: unknown) {
				return Promise.resolve({ receiver: this.name, args });
			},
		};
		const resolve = vi.fn(async () => ({ session }) as unknown as OpenCodeClient);
		const client = createDeferredKiloClient(resolve);

		await expect(client.session.get({ sessionID: "a" })).resolves.toEqual({
			receiver: "session",
			args: { sessionID: "a" },
		});
		expect(client.session).toBe(client.session);
		expect((client as unknown as { then?: unknown }).then).toBeUndefined();
	});

	it("reaches nested namespaces", async () => {
		const reply = vi.fn(async () => undefined);
		const client = deferred({ session: { form: { reply } } });

		await client.session.form.reply({ sessionID: "s", formID: "f", answer: {} });

		expect(reply).toHaveBeenCalledWith({ sessionID: "s", formID: "f", answer: {} });
	});

	it("starts a call at once, awaited or not", async () => {
		const interrupt = vi.fn(async () => ({ interrupted: true }));
		const client = deferred({ session: { interrupt } });

		void client.session.interrupt({ sessionID: "s" });

		await vi.waitFor(() => expect(interrupt).toHaveBeenCalledOnce());
	});

	it("iterates what a call returns synchronously, such as the event stream", async () => {
		async function* frames() {
			yield { type: "server.connected" };
			yield { type: "session.idle" };
		}
		const client = deferred({ event: { subscribe: () => frames() } });

		const seen: unknown[] = [];
		for await (const frame of client.event.subscribe()) seen.push(frame);

		expect(seen).toEqual([{ type: "server.connected" }, { type: "session.idle" }]);
	});

	it("calls members of what a call returns, such as an RPC client", async () => {
		const usage = {
			id: "rpc",
			read(this: { id: string }, input: unknown) {
				return Promise.resolve({ from: this.id, input });
			},
		};
		const rpc = vi.fn(() => usage);
		const client = deferred({ rpc }) as unknown as {
			rpc(definition: unknown): { read(input: unknown): Promise<unknown> };
		};

		await expect(client.rpc({ id: "usage" }).read({ a: 1 })).resolves.toEqual({
			from: "rpc",
			input: { a: 1 },
		});
		expect(rpc).toHaveBeenCalledWith({ id: "usage" });
	});

	it("rejects calls on what isn't there", async () => {
		const client = deferred({ session: { nested: {} }, empty: null });
		const loose = client as unknown as Record<string, Record<string, () => Promise<unknown>>>;

		await expect(loose.empty!.call!()).rejects.toThrow("is not an object");
		await expect(loose.session!.nested!()).rejects.toThrow("is not a function");
	});
});
