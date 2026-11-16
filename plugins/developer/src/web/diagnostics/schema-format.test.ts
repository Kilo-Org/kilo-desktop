import { describe, expect, it } from "vitest";
import { z } from "zod";

import { method } from "@kilo-desktop/kernel";

import { formatEvent, formatMethod, formatType } from "./schema-format";

describe("formatType", () => {
	it("writes primitives, literals and enums as TypeScript types", () => {
		expect(formatType(z.string())).toBe("string");
		expect(formatType(z.int().min(0))).toBe("number");
		expect(formatType(z.boolean())).toBe("boolean");
		expect(formatType(z.date())).toBe("Date");
		expect(formatType(z.unknown())).toBe("unknown");
		expect(formatType(z.literal("daemon"))).toBe('"daemon"');
		expect(formatType(z.enum(["main", "renderer"]))).toBe('"main" | "renderer"');
	});

	it("writes collections, unions and nullables", () => {
		expect(formatType(z.array(z.enum(["a", "b"])))).toBe('("a" | "b")[]');
		expect(formatType(z.record(z.string(), z.number()))).toBe("Record<string, number>");
		expect(formatType(z.string().nullable())).toBe("string | null");
		expect(formatType(z.union([z.string(), z.array(z.string())]))).toBe("string | string[]");
		expect(formatType(z.tuple([z.string(), z.number()]))).toBe("[string, number]");
	});

	it("keeps a short object on one line", () => {
		expect(formatType(z.object({ pluginId: z.string(), enabled: z.boolean() }))).toBe(
			"{ pluginId: string; enabled: boolean }",
		);
		expect(formatType(z.object({}))).toBe("{}");
	});

	it("breaks a long object into lines, marking optional fields and noting defaults and descriptions", () => {
		const metadata = z.object({
			title: z.string(),
			category: z.string().describe("The heading commands are grouped under.").optional(),
			palette: z.boolean().default(true),
			restart: z.object({ policy: z.enum(["never", "on-failure"]) }).optional(),
		});

		expect(formatType(metadata)).toBe(
			[
				"{",
				"  title: string;",
				"  /** The heading commands are grouped under. */",
				"  category?: string;",
				"  palette?: boolean; // default: true",
				'  restart?: { policy: "never" | "on-failure" };',
				"}",
			].join("\n"),
		);
	});

	it("indents nested multi-line objects", () => {
		const state = z.object({
			plugins: z.record(
				z.string(),
				z.object({ displayName: z.string(), version: z.string(), state: z.string() }),
			),
		});

		expect(formatType(state)).toBe(
			[
				"{",
				"  plugins: Record<string, {",
				"    displayName: string;",
				"    version: string;",
				"    state: string;",
				"  }>;",
				"}",
			].join("\n"),
		);
	});

	it("shows what authors write for a transformed schema", () => {
		expect(formatType(z.string().transform(Number))).toBe("string");
	});

	it("stops at a recursive schema instead of looping", () => {
		interface Node {
			readonly children: Node[];
		}
		const node: z.ZodType<Node> = z.lazy(() => z.object({ children: z.array(node) }));

		expect(formatType(node)).toContain("…");
	});

	it("writes the rest of zod's types", () => {
		expect(
			formatType(z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }))),
		).toBe("{ a: string } & { b: number }");
		expect(formatType(z.map(z.string(), z.number()))).toBe("Map<string, number>");
		expect(formatType(z.set(z.string()))).toBe("Set<string>");
		expect(formatType(z.promise(z.string()))).toBe("Promise<string>");
		expect(formatType(z.function())).toBe("(...args: unknown[]) => unknown");
		expect(formatType(z.string().optional())).toBe("string | undefined");
		expect(formatType(z.array(z.string().optional()))).toBe("(string | undefined)[]");
		expect(formatType(z.tuple([z.string()], z.number()))).toBe("[string, ...number[]]");
		expect(formatType(z.literal(1n))).toBe("1n");
		expect(formatType(z.string().readonly())).toBe("string");
		expect(formatType(z.custom<Date>())).toBe("unknown");
	});

	it("quotes property names that aren't identifiers and lists other keys a loose object allows", () => {
		expect(formatType(z.looseObject({ "kernel/app": z.boolean() }))).toBe(
			'{ "kernel/app": boolean; [key: string]: unknown }',
		);
	});

	it("falls back to unknown for something that is not a schema", () => {
		expect(formatType(undefined)).toBe("unknown");
		expect(formatType({})).toBe("unknown");
	});
});

describe("formatMethod", () => {
	it("writes a domain method as a call signature", () => {
		expect(
			formatMethod(
				"setEnabled",
				method(z.object({ pluginId: z.string(), enabled: z.boolean() }), z.undefined()),
			),
		).toBe("setEnabled(input: { pluginId: string; enabled: boolean }): void");
		expect(formatMethod("takeLaunchUrl", method(z.undefined(), z.string().nullable()))).toBe(
			"takeLaunchUrl(): string | null",
		);
	});
});

describe("formatEvent", () => {
	it("writes an event with its payload", () => {
		expect(formatEvent("phase-changed", z.object({ phase: z.enum(["starting", "ready"]) }))).toBe(
			'"phase-changed": { phase: "starting" | "ready" }',
		);
	});
});
