import { describe, expect, it } from "vitest";

import { KernelError } from "./errors";
import { createLinkedTransports } from "./transport";

describe("createLinkedTransports", () => {
	it("targets one window, or every window but one, when main sends", async () => {
		const transports = createLinkedTransports();
		const first = transports.connectRenderer("w1");
		const second = transports.connectRenderer("w2");
		const received: string[] = [];
		first.on("note", (payload) => void received.push(`w1:${String(payload)}`));
		second.on("note", (payload) => void received.push(`w2:${String(payload)}`));

		transports.main.send("note", "all");
		transports.main.send("note", "only-w2", { toWindow: "w2" });
		transports.main.send("note", "not-w2", { exceptWindow: "w2" });
		await transports.main.flush!();

		expect(received.sort()).toEqual(["w1:all", "w1:not-w2", "w2:all", "w2:only-w2"]);
	});

	it("clones payloads so neither side can mutate the other's copy", async () => {
		const transports = createLinkedTransports();
		const renderer = transports.connectRenderer("w1");
		const sent = { value: 1 };
		let received: { value: number } | undefined;
		transports.main.on("echo", (payload) => void (received = payload as { value: number }));

		renderer.send("echo", sent);
		sent.value = 2;
		await renderer.flush!();

		expect(received).toEqual({ value: 1 });
	});

	it("rejects requests without a handler and passes expected errors through", async () => {
		const transports = createLinkedTransports();
		const renderer = transports.connectRenderer("w1");
		transports.main.handle("fails", () => {
			throw new KernelError("CONFLICT", "Already exists.");
		});

		await expect(renderer.request("missing", null)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(renderer.request("fails", null)).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Already exists.",
		});
	});

	it("knows which window a renderer message came from", async () => {
		const transports = createLinkedTransports();
		const renderer = transports.connectRenderer("w9");
		const origins: unknown[] = [];
		transports.main.on("hello", (_payload, from) => void origins.push(from));

		renderer.send("hello", null);
		await renderer.flush!();

		expect(origins).toEqual([{ process: "renderer", windowId: "w9" }]);
	});
});
