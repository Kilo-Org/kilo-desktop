import { describe, expect, it } from "vitest";

import { defineObjectType, isRef, ref } from "./object-type";

const Chat = defineObjectType({ id: "acme.core/chat", description: "A chat." });

describe("object references", () => {
	it("builds a reference of an object type", () => {
		expect(ref(Chat, "c1")).toEqual({ type: "acme.core/chat", id: "c1" });
	});

	it("recognises only references of the given type", () => {
		expect(isRef(Chat, ref(Chat, "c1"))).toBe(true);
		expect(isRef(Chat, { type: "acme.core/other", id: "c1" })).toBe(false);
		expect(isRef(Chat, { type: "acme.core/chat" })).toBe(false);
		expect(isRef(Chat, null)).toBe(false);
	});
});
