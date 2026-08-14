import { describe, expect, it, vi } from "vitest";

import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";
import type { ModelContextTesting } from "@mcp-b/webmcp-types";

import { installWebMcp, nudgeRelayWidget } from "./installWebMcp";

// installWebMcp is a renderer-lifetime singleton (module-level `installed` flag),
// so every test in this file shares one install over one fake feature system.
const todos = createFakeSdk({ featureId: "todos" });
const system = createFakeFeatureSystem({ sdks: { todos } });

function modelContextTesting(): ModelContextTesting | undefined {
	return (navigator as Navigator & { modelContextTesting?: ModelContextTesting })
		.modelContextTesting;
}

function listTools(): Array<{ name: string; description: string }> {
	return modelContextTesting()?.listTools() ?? [];
}

function listToolNames(): string[] {
	return listTools().map((tool) => tool.name);
}

describe("installWebMcp", () => {
	it("publishes only opted-in tools and executes them through the registry", async () => {
		todos.tools.register({
			name: "echo",
			description: "Echo the args back",
			exposeToModelContext: true,
			handler: (args) => ({ echoed: args }),
		});
		todos.tools.register({
			name: "hidden",
			description: "Registered for in-app use only",
			handler: () => "never exposed",
		});

		installWebMcp(system);

		await expect.poll(() => listToolNames()).toContain("todos_echo");
		expect(listToolNames()).not.toContain("todos_hidden");

		// Execute via the testing shim — the same discovery/execution path the
		// self-hosted relay embed uses. The shim returns the serialized CallToolResult.
		const raw = await modelContextTesting()?.executeTool("todos_echo", JSON.stringify({ a: 1 }));
		const result = JSON.parse(raw ?? "{}") as {
			content?: Array<{ type: string; text: string }>;
		};
		expect(JSON.parse(result.content?.[0]?.text ?? "{}")).toEqual({ echoed: { a: 1 } });
	});

	it("re-syncs on registry changes: unregistering removes the published tool", async () => {
		const unregister = todos.tools.register({
			name: "temp",
			description: "Temporary tool",
			exposeToModelContext: true,
			handler: () => "ok",
		});

		await expect.poll(() => listToolNames()).toContain("todos_temp");

		unregister();
		await expect.poll(() => listToolNames()).not.toContain("todos_temp");
	});

	it("re-publishes a re-registered tool whose advertised metadata changed", async () => {
		todos.tools.register({
			name: "evolving",
			description: "Version one",
			exposeToModelContext: true,
			handler: () => "v1",
		});
		await expect
			.poll(() => listTools().find((tool) => tool.name === "todos_evolving")?.description)
			.toBe("Version one");

		// Re-registering the same name replaces the entry (registry warns); the
		// bridge must notice the descriptor change and re-publish, not leave the
		// stale advertisement.
		todos.tools.register({
			name: "evolving",
			description: "Version two",
			exposeToModelContext: true,
			handler: () => "v2",
		});
		await expect
			.poll(() => listTools().find((tool) => tool.name === "todos_evolving")?.description)
			.toBe("Version two");
	});

	it("reports handler failures as tool errors instead of throwing", async () => {
		todos.tools.register({
			name: "boom",
			description: "Always fails",
			exposeToModelContext: true,
			handler: () => {
				throw new Error("kaboom");
			},
		});

		await expect.poll(() => listToolNames()).toContain("todos_boom");

		// The bridge wraps handler errors into an isError result; the testing shim
		// surfaces that as a rejected/failed execution rather than a crash.
		await expect(
			(async () => {
				const output = await modelContextTesting()?.executeTool("todos_boom", "{}");
				// Some shim versions resolve with the error payload instead of rejecting.
				if (typeof output === "string" && output.includes("kaboom")) {
					throw new Error("kaboom");
				}
				return output;
			})(),
		).rejects.toThrow(/kaboom/);
	});

	it("skips a second tool whose sanitized MCP name would collide with an existing one", async () => {
		// Two registry ids that both sanitize to `todos_collide_x` on the MCP wire.
		// The first wins; the second is dropped with a warning so it can't silently
		// overwrite the earlier publication on document.modelContext.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		todos.tools.register({
			name: "collide.x",
			description: "First (dot form)",
			exposeToModelContext: true,
			handler: () => "first",
		});
		todos.tools.register({
			name: "collide_x",
			description: "Second (underscore form)",
			exposeToModelContext: true,
			handler: () => "second",
		});

		await expect.poll(() => listToolNames()).toContain("todos_collide_x");
		// Only ONE MCP entry with that name — no shadow duplicate.
		expect(listTools().filter((tool) => tool.name === "todos_collide_x")).toHaveLength(1);
		// The winner is the FIRST one registered (dot form).
		expect(listTools().find((tool) => tool.name === "todos_collide_x")?.description).toBe(
			"First (dot form)",
		);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/sanitizes to MCP name/));
		warnSpy.mockRestore();
	});

	it("pins the relay identity and port on the embed script (split-brain guard)", () => {
		// 9333-9348 is a shared rendezvous range used by every WebMCP relay on
		// the machine (Claude Desktop, npx relays, ...). Without the id/port pin
		// the widget can pair with a foreign relay while kilo's own relay has
		// zero producers — tools silently vanish. Values MUST match the Desktop-provided
		// relay args in plugins/kilo-server/src/main/webmcp-relay-config.ts.
		const embed = document.querySelector<HTMLScriptElement>("script[data-webmcp-embed]");
		expect(embed).not.toBeNull();
		expect(embed?.getAttribute("data-relay-host")).toBe("127.0.0.1");
		expect(embed?.getAttribute("data-relay-port")).toBe("9345");
		expect(embed?.getAttribute("data-relay-id")).toBe("anaconda-agentic-desktop");
	});

	it("nudges the relay widget with webmcp.connect (boot-order race guard)", async () => {
		// kilo serve boots MCP servers lazily, so the relay can bind AFTER the
		// widget's finite discovery ladder went dormant. The nudge posts
		// webmcp.connect into the widget iframe to force re-discovery; the
		// widget treats it as a no-op when already connected.
		const iframe = document.createElement("iframe");
		iframe.setAttribute("data-webmcp-relay", "1");
		iframe.srcdoc = "<!doctype html><html><body></body></html>";
		document.body.append(iframe);
		await new Promise((resolve) => iframe.addEventListener("load", resolve, { once: true }));

		const received: unknown[] = [];
		iframe.contentWindow?.addEventListener("message", (event) => received.push(event.data));

		nudgeRelayWidget();

		await expect
			.poll(() =>
				received.some(
					(message) =>
						typeof message === "object" &&
						message !== null &&
						(message as { type?: string }).type === "webmcp.connect",
				),
			)
			.toBe(true);
		iframe.remove();
	});

	it("publishes a tool's advertised annotations to model context", async () => {
		// The testing shim strips annotations from its read surface, so spy on the
		// registerTool call the bridge makes to assert annotations are forwarded.
		const modelContext = document.modelContext;
		expect(modelContext).toBeTruthy();
		const registerSpy = vi.spyOn(
			modelContext as NonNullable<Document["modelContext"]>,
			"registerTool",
		);

		todos.tools.register({
			name: "annotated",
			description: "Has annotations",
			exposeToModelContext: true,
			annotations: { title: "Annotated tool", readOnlyHint: true },
			handler: () => "ok",
		});

		await expect.poll(() => listToolNames()).toContain("todos_annotated");
		const call = registerSpy.mock.calls.find(
			([descriptor]) => descriptor.name === "todos_annotated",
		);
		expect(call?.[0].annotations).toEqual({ title: "Annotated tool", readOnlyHint: true });
		registerSpy.mockRestore();
	});

	it("wraps a non-Error thrown by a handler as a tool error result", async () => {
		todos.tools.register({
			name: "stringThrow",
			description: "Throws a string",
			exposeToModelContext: true,
			handler: () => {
				// eslint-disable-next-line no-throw-literal
				throw "plain string failure";
			},
		});

		await expect.poll(() => listToolNames()).toContain("todos_stringThrow");

		// The bridge coerces the non-Error throw into an isError result via
		// `String(error)`; the testing shim surfaces that as a failed execution.
		await expect(
			(async () => {
				const output = await modelContextTesting()?.executeTool("todos_stringThrow", "{}");
				if (typeof output === "string" && output.includes("plain string failure")) {
					throw new Error("plain string failure");
				}
				return output;
			})(),
		).rejects.toThrow(/plain string failure/);
	});

	it("warns but does not throw when the relay embed script fails to load", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const embed = document.querySelector<HTMLScriptElement>("script[data-webmcp-embed]");

		embed?.dispatchEvent(new Event("error"));

		expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/relay embed script/));
		warnSpy.mockRestore();
	});

	it("is a no-op on a second install call (renderer-lifetime singleton)", () => {
		const embedsBefore = document.querySelectorAll("script[data-webmcp-embed]").length;

		expect(() => installWebMcp(system)).not.toThrow();

		// No duplicate embed script is injected on the repeated call.
		expect(document.querySelectorAll("script[data-webmcp-embed]").length).toBe(embedsBefore);
	});
});
