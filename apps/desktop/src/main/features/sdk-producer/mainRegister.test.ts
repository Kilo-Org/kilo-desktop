import { describe, expect, it } from "vitest";
import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

import { mainRegister } from "./index.js";

describe("sdk-producer mainRegister", () => {
	it("registers all expected handlers", () => {
		const mainSdk = createFakeMainSdk({ featureId: "sdk-producer" });
		mainRegister(mainSdk);

		expect(mainSdk.registeredHandlers.has("list")).toBe(true);
		expect(mainSdk.registeredHandlers.has("add")).toBe(true);
		expect(mainSdk.registeredHandlers.has("delete")).toBe(true);
		expect(mainSdk.registeredHandlers.has("clear")).toBe(true);
		expect(mainSdk.registeredHandlers.has("echo")).toBe(true);
	});

	it("registers input schemas for all handlers", () => {
		const mainSdk = createFakeMainSdk({ featureId: "sdk-producer" });
		mainRegister(mainSdk);

		// All channels have schemas registered
		expect(mainSdk.registeredSchemas.has("list")).toBe(true);
		expect(mainSdk.registeredSchemas.has("add")).toBe(true);
		expect(mainSdk.registeredSchemas.has("delete")).toBe(true);
		expect(mainSdk.registeredSchemas.has("clear")).toBe(true);
		expect(mainSdk.registeredSchemas.has("echo")).toBe(true);
	});

	it("registers a dispose callback", () => {
		const mainSdk = createFakeMainSdk({ featureId: "sdk-producer" });
		mainRegister(mainSdk);

		expect(mainSdk.disposeCallbacks.length).toBeGreaterThan(0);
	});

	it("list handler returns empty array initially (via invoke)", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "sdk-producer" });
		mainRegister(mainSdk);

		const result = await mainSdk.invoke("list", undefined);
		expect(result).toEqual([]);
	});

	it("add handler creates and returns a note (via invoke with validation)", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "sdk-producer" });
		mainRegister(mainSdk);

		const note = (await mainSdk.invoke("add", { text: "hello" })) as {
			id: string;
			text: string;
		};
		expect(note.text).toBe("hello");
		expect(note.id).toBeDefined();
	});

	it("echo handler echoes with prefix (via invoke)", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "sdk-producer" });
		mainRegister(mainSdk);

		const result = (await mainSdk.invoke("echo", { message: "ping" })) as { echoed: string };
		expect(result.echoed).toBe("[sdk-producer] ping");
	});

	it("add validation rejects empty text (schema enforced at boundary)", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "sdk-producer" });
		mainRegister(mainSdk);

		// Schema validation happens before handler runs
		await expect(async () => mainSdk.invoke("add", { text: "" })).rejects.toThrow();
	});

	it("add validation rejects missing text field", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "sdk-producer" });
		mainRegister(mainSdk);

		await expect(async () => mainSdk.invoke("add", {})).rejects.toThrow();
	});

	it("delete handler works after adding a note", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "sdk-producer" });
		mainRegister(mainSdk);

		const note = (await mainSdk.invoke("add", { text: "to delete" })) as { id: string };
		const result = (await mainSdk.invoke("delete", { id: note.id })) as { deleted: boolean };
		expect(result.deleted).toBe(true);

		const list = (await mainSdk.invoke("list", undefined)) as unknown[];
		expect(list).toHaveLength(0);
	});

	it("clear handler removes all notes and returns count", async () => {
		const mainSdk = createFakeMainSdk({ featureId: "sdk-producer" });
		mainRegister(mainSdk);

		await mainSdk.invoke("add", { text: "one" });
		await mainSdk.invoke("add", { text: "two" });
		const result = (await mainSdk.invoke("clear", undefined)) as { count: number };
		expect(result.count).toBe(2);
	});
});
