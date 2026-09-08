import { describe, expect, it } from "vitest";

import { pushTerminalChunk } from "./push-terminal-chunk.js";

describe("pushTerminalChunk", () => {
	it("appends chunks while under the capacity", () => {
		const chunks: string[] = [];
		pushTerminalChunk(chunks, 10, "hello");
		pushTerminalChunk(chunks, 10, "world");
		expect(chunks.join("")).toBe("helloworld");
	});

	it("drops whole oldest chunks once the capacity is exceeded", () => {
		const chunks: string[] = [];
		pushTerminalChunk(chunks, 3, "aaa");
		pushTerminalChunk(chunks, 3, "bbb");
		expect(chunks).toEqual(["bbb"]);
	});

	it("trims the head chunk partially when only part of it overruns", () => {
		const chunks: string[] = [];
		pushTerminalChunk(chunks, 5, "aaaa");
		pushTerminalChunk(chunks, 5, "bbb");
		expect(chunks).toEqual(["aa", "bbb"]);
		expect(chunks.join("")).toBe("aabbb");
	});

	it("keeps the most recent capacity characters of a single oversized chunk", () => {
		const chunks: string[] = [];
		pushTerminalChunk(chunks, 3, "abcdefg");
		expect(chunks.join("")).toBe("efg");
	});

	it("coerces Buffer chunks as utf8", () => {
		const chunks: string[] = [];
		pushTerminalChunk(chunks, 100, Buffer.from("héllo", "utf8"));
		expect(chunks.join("")).toBe("héllo");
	});

	it("counts capacity in characters, not bytes", () => {
		const chunks: string[] = [];
		pushTerminalChunk(chunks, 2, "åä");
		expect(chunks.join("")).toBe("åä");

		pushTerminalChunk(chunks, 2, "ö");
		expect(chunks.join("")).toBe("äö");
	});
});
