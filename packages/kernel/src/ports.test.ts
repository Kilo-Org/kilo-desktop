import { describe, expect, it, vi } from "vitest";

import { KernelError } from "./errors";
import { createTestKernelPair, testPlugin } from "./testing";
import type { KernelPort } from "./ports";

function nextMessage(port: MessagePort): Promise<unknown> {
	return new Promise((resolve) => {
		port.addEventListener("message", (event) => resolve(event.data), { once: true });
		port.start();
	});
}

function closed(port: KernelPort): Promise<void> {
	return new Promise((resolve) => port.onClose(resolve));
}

describe("ports", () => {
	it("streams between a plugin's window and its main handler, which learns who opened it", async () => {
		const opened = vi.fn();
		let mainEnd: KernelPort | undefined;
		const { main, renderer } = await createTestKernelPair({
			main: [
				testPlugin("acme.term", {
					entry: {
						activate(sdk) {
							sdk.ports.handle("session", (port, args, caller) => {
								opened(args, caller);
								mainEnd = port;
								port.onMessage((data) => port.postMessage({ echo: data }));
							});
						},
					},
				}),
			],
			renderer: [testPlugin("acme.term", { entry: { activate: () => {} } })],
		});
		await main.flush();

		const port = renderer.sdkFor("acme.term").ports.open("session", { cols: 80 });
		const reply = nextMessage(port);
		port.postMessage("ls");

		await expect(reply).resolves.toEqual({ echo: "ls" });
		expect(opened).toHaveBeenCalledWith({ cols: 80 }, { pluginId: "acme.term", windowId: "main" });

		const ended = closed(mainEnd!);
		port.close();
		await ended;
	});

	it("holds messages sent before a handler that subscribes after an await", async () => {
		const { main, renderer } = await createTestKernelPair({
			main: [
				testPlugin("acme.term", {
					entry: {
						activate(sdk) {
							sdk.ports.handle("session", (port) => {
								void new Promise((resolve) => setTimeout(resolve, 20)).then(() =>
									port.onMessage((data) => port.postMessage({ echo: data })),
								);
							});
						},
					},
				}),
			],
			renderer: [testPlugin("acme.term", { entry: { activate: () => {} } })],
		});
		await main.flush();

		const port = renderer.sdkFor("acme.term").ports.open("session");
		const replies: unknown[] = [];
		const both = new Promise<void>((resolve) => {
			port.addEventListener("message", (event) => {
				replies.push(event.data);
				if (replies.length === 2) resolve();
			});
		});
		port.start();
		port.postMessage("first");
		port.postMessage("second");

		await both;
		expect(replies).toEqual([{ echo: "first" }, { echo: "second" }]);
		port.close();
	});

	it("closes a port nobody handles", async () => {
		const { renderer } = await createTestKernelPair({
			main: [],
			renderer: [testPlugin("acme.term", { entry: { activate: () => {} } })],
		});

		const port = renderer.sdkFor("acme.term").ports.open("missing");
		const gone = new Promise<void>((resolve) => port.addEventListener("close", () => resolve()));
		port.start();

		await gone;
	});

	it("handles in main and opens in windows only, one handler per name", async () => {
		const { main, renderer } = await createTestKernelPair({
			main: [testPlugin("acme.term", { entry: { activate: () => {} } })],
			renderer: [testPlugin("acme.term", { entry: { activate: () => {} } })],
		});
		const mainSdk = main.sdkFor("acme.term");
		mainSdk.ports.handle("session", () => undefined);

		expect(() => mainSdk.ports.handle("session", () => undefined)).toThrow(KernelError);
		expect(() => mainSdk.ports.open("session")).toThrow(/opened from a window/);
		expect(() => renderer.sdkFor("acme.term").ports.handle("x", () => undefined)).toThrow(
			/handled in the main process/,
		);
	});
});
