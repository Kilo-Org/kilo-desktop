import { describe, expect, it } from "vitest";

import { createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import { mainRegister } from "./index.js";

describe("sdk-consumer mainRegister", () => {
	it("reads the producer capability lazily from mainSdk.plugins", async () => {
		const linked = createLinkedFakeSdkPair({ featureId: "renderer" });
		const producer = linked.createMainSdk("sdk-producer");
		const consumer = linked.createMainSdk("sdk-consumer");
		mainRegister(consumer);

		await expect(consumer.invoke("ping")).resolves.toEqual({
			pong: true,
			from: "sdk-consumer",
			producerNoteCount: null,
		});

		producer.plugins.expose("notesService", { count: () => 3 });
		await expect(consumer.invoke("ping")).resolves.toEqual({
			pong: true,
			from: "sdk-consumer",
			producerNoteCount: 3,
		});
	});
});
