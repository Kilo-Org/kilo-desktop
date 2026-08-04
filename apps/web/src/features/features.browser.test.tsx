import { afterEach, describe, expect, it, vi } from "vitest";

import type { Note } from "@anaconda-agentic-desktop/contracts";
import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

import { WEB_FEATURES } from "@/features/features";
import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { createAppFeatureSystem } from "@/platform/featureSystem";

const systems: Array<ReturnType<typeof createAppFeatureSystem>> = [];

afterEach(() => {
	for (const system of systems.splice(0)) system.dispose();
});

function builtInFeature(id: string): FeatureRegistration {
	const feature = WEB_FEATURES.find((candidate) => candidate.id === id);
	if (!feature) throw new Error(`Missing built-in feature registration: ${id}`);
	return feature;
}

describe("built-in browser feature registrations", () => {
	it("implements producer channels, events, and the consumer's main-side capability read", async () => {
		const producerRegistration = builtInFeature("sdk-producer");
		const consumerRegistration = builtInFeature("sdk-consumer");
		const system = createAppFeatureSystem(createBrowserLocalApi(), [
			producerRegistration,
			consumerRegistration,
		]);
		systems.push(system);
		const producer = system.getSdk("sdk-producer");
		const consumer = system.getSdk("sdk-consumer");
		const noteAdded = vi.fn();
		producer.events.on("sdk-producer.note-added", noteAdded);

		const note = (await producer.invoke("add", { text: "hello" })) as Note;
		expect(await producer.invoke("list")).toEqual([note]);
		expect(noteAdded).toHaveBeenCalledWith({ id: note.id, text: "hello" });
		expect(await consumer.invoke("ping")).toEqual({
			pong: true,
			from: "sdk-consumer",
			producerNoteCount: 1,
		});
		expect(await producer.invoke("delete", { id: "missing" })).toEqual({ deleted: false });
		expect(await producer.invoke("delete", { id: note.id })).toEqual({ deleted: true });

		await producer.invoke("add", { text: "clear me" });
		expect(await producer.invoke("clear")).toEqual({ count: 1 });
		expect(await producer.invoke("echo", { message: "test" })).toMatchObject({
			echoed: "[sdk-producer] test",
			timestamp: expect.any(Number),
		});
	});

	it("returns null when the producer capability is not active", async () => {
		const system = createAppFeatureSystem(createBrowserLocalApi(), [
			builtInFeature("sdk-consumer"),
		]);
		systems.push(system);

		await expect(system.getSdk("sdk-consumer").invoke("ping")).resolves.toEqual({
			pong: true,
			from: "sdk-consumer",
			producerNoteCount: null,
		});
	});
});
