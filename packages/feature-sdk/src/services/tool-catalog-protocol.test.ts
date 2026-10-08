import { describe, expect, it } from "vitest";

import {
	TOOL_CATALOG_PROTOCOL_VERSION,
	toolCatalogConsumerMessageSchema,
	toolCatalogPortArgsSchema,
	toolCatalogProducerMessageSchema,
	toolDescriptorSchema,
} from "./tool-catalog-protocol.js";

const echo = {
	name: "todos_echo",
	description: "Echo text back",
	inputSchema: { type: "object", properties: { text: { type: "string" } } },
};

describe("tool catalog protocol", () => {
	it("accepts the current protocol version when a producer opens its port", () => {
		expect(
			toolCatalogPortArgsSchema.safeParse({ version: TOOL_CATALOG_PROTOCOL_VERSION }).success,
		).toBe(true);
		expect(toolCatalogPortArgsSchema.safeParse({ version: 2 }).success).toBe(false);
		expect(toolCatalogPortArgsSchema.safeParse(undefined).success).toBe(false);
	});

	it.each([
		["a name with characters MCP clients reject", { ...echo, name: "todos.echo" }],
		["an empty name", { ...echo, name: "" }],
		["a name longer than 128 characters", { ...echo, name: "a".repeat(129) }],
		["a non-object input schema", { ...echo, inputSchema: { type: "string" } }],
	])("rejects a tool descriptor with %s", (_label, descriptor) => {
		expect(toolDescriptorSchema.safeParse(descriptor).success).toBe(false);
	});

	it("keeps descriptor annotations and extra JSON Schema keywords", () => {
		const descriptor = {
			...echo,
			inputSchema: { ...echo.inputSchema, required: ["text"], additionalProperties: false },
			annotations: { readOnlyHint: true, title: "Echo" },
		};

		expect(toolDescriptorSchema.parse(descriptor)).toEqual(descriptor);
	});

	it("parses catalog snapshots and call results sent by the producer", () => {
		expect(
			toolCatalogProducerMessageSchema.parse({ type: "catalog", revision: 3, tools: [echo] }),
		).toEqual({ type: "catalog", revision: 3, tools: [echo] });
		expect(
			toolCatalogProducerMessageSchema.parse({
				type: "result",
				id: "c1",
				ok: true,
				result: { a: 1 },
			}),
		).toEqual({ type: "result", id: "c1", ok: true, result: { a: 1 } });
		expect(
			toolCatalogProducerMessageSchema.parse({
				type: "result",
				id: "c1",
				ok: false,
				error: { message: "boom" },
			}),
		).toEqual({ type: "result", id: "c1", ok: false, error: { message: "boom" } });
	});

	it("parses calls and cancellations sent to the producer", () => {
		expect(
			toolCatalogConsumerMessageSchema.parse({
				type: "call",
				id: "c1",
				name: "todos_echo",
				args: { text: "hi" },
				context: { kiloSessionId: "s1", kiloCallId: "k1" },
			}),
		).toMatchObject({ type: "call", context: { kiloSessionId: "s1" } });
		expect(toolCatalogConsumerMessageSchema.parse({ type: "cancel", id: "c1" })).toEqual({
			type: "cancel",
			id: "c1",
		});
	});
});
