import type { KiloClient } from "@kilocode/sdk/v2/client";
import { describe, expect, it, vi } from "vitest";

import { createDeferredKiloClient } from "./deferred-client";

describe("createDeferredKiloClient", () => {
	it("calls the client it resolves, with its own receiver", async () => {
		const session = {
			name: "session",
			get(this: { name: string }, args: unknown) {
				return { receiver: this.name, args };
			},
		};
		const resolve = vi.fn(async () => ({ session }) as unknown as KiloClient);
		const client = createDeferredKiloClient(resolve);

		await expect(client.session.get({ sessionID: "a" } as never)).resolves.toEqual({
			receiver: "session",
			args: { sessionID: "a" },
		});
		expect(client.session).toBe(client.session);
		expect((client as unknown as { then?: unknown }).then).toBeUndefined();
	});

	it("rejects calls on what isn't there", async () => {
		const client = createDeferredKiloClient(
			async () => ({ session: { nested: {} }, empty: null }) as unknown as KiloClient,
		);
		const loose = client as unknown as Record<string, Record<string, () => Promise<unknown>>>;

		await expect(loose.empty!.call!()).rejects.toThrow("is not an object");
		await expect(loose.session!.nested!()).rejects.toThrow("is not a function");
	});
});
