import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { echoTool, FakeToolSource, toolContribution } from "../../../test/agent/tool-source";
import { mcpToolName, ToolCatalog } from "./tool-catalog";

describe("ToolCatalog", () => {
	it("lists contributed tools under their MCP names with JSON input schemas", () => {
		const catalog = new ToolCatalog(
			new FakeToolSource([
				toolContribution("kilo.terminal/read", echoTool([], z.object({ lines: z.number() })), {
					readOnly: true,
				}),
				toolContribution("acme.todos/list"),
			]),
		);

		expect(catalog.tools.map((tool) => [tool.name, tool.wireName])).toEqual([
			["terminal_read", "desktop_terminal_read"],
			["acme_todos_list", "desktop_acme_todos_list"],
		]);
		expect(catalog.find("terminal_read")).toMatchObject({
			description: "Echo the input.",
			inputSchema: {
				type: "object",
				properties: { lines: { type: "number" } },
				required: ["lines"],
			},
			metadata: { readOnly: true },
		});
		expect(catalog.find("terminal_read")?.inputSchema).not.toHaveProperty("$schema");
	});

	it("describes optional and defaulted inputs as callers may send them", () => {
		const catalog = new ToolCatalog(
			new FakeToolSource([
				toolContribution(
					"kilo.terminal/read",
					echoTool([], z.object({ lines: z.number().default(200) })),
				),
			]),
		);

		expect(catalog.find("terminal_read")?.inputSchema).not.toHaveProperty("required");
	});

	it("announces only real changes to what clients see", () => {
		const source = new FakeToolSource([toolContribution("kilo.terminal/list")]);
		const catalog = new ToolCatalog(source);
		const changed = vi.fn();
		catalog.subscribe(changed);
		const version = catalog.version;

		source.set([toolContribution("kilo.terminal/list")]);
		expect(changed).not.toHaveBeenCalled();
		expect(catalog.version).toBe(version);

		source.set([toolContribution("kilo.terminal/list"), toolContribution("kilo.terminal/open")]);
		expect(changed).toHaveBeenCalledOnce();
		expect(catalog.version).toBe(version + 1);

		source.set([
			toolContribution("kilo.terminal/list", undefined, { requiresSignIn: true }),
			toolContribution("kilo.terminal/open"),
		]);
		expect(changed).toHaveBeenCalledTimes(2);
	});

	it("runs the implementation bound most recently", async () => {
		const first = echoTool();
		const second = { ...echoTool(), run: () => "second" };
		const source = new FakeToolSource([toolContribution("kilo.terminal/list", first)]);
		const catalog = new ToolCatalog(source);

		source.set([toolContribution("kilo.terminal/list", second)]);

		expect(catalog.find("terminal_list")?.implementation).toBe(second);
	});

	it("leaves out unimplemented tools, name clashes and inputs that aren't objects", () => {
		const logger = { warn: vi.fn() };
		const { implementation: _unbound, ...unimplemented } = toolContribution("kilo.terminal/gone");
		const source = new FakeToolSource([
			toolContribution("kilo.terminal/list"),
			unimplemented,
			toolContribution("kilo.terminal/open"),
			toolContribution("terminal/open"),
			toolContribution("kilo.terminal/read", echoTool([], z.string())),
			toolContribution("kilo.terminal/when", echoTool([], z.object({ at: z.date() }))),
		]);
		const catalog = new ToolCatalog(source, logger);

		expect(catalog.tools.map((tool) => tool.name)).toEqual(["terminal_list", "terminal_open"]);
		expect(logger.warn.mock.calls.map(([message]) => message)).toEqual([
			'Skipped tool "terminal/open": "terminal_open" is already taken.',
			'Skipped tool "kilo.terminal/read": its input must be an object.',
			expect.stringContaining('Skipped tool "kilo.terminal/when": its input has no JSON schema'),
		]);

		source.set(source.list());
		expect(logger.warn).toHaveBeenCalledTimes(3);
	});

	it("stops following the source once disposed", () => {
		const source = new FakeToolSource();
		const catalog = new ToolCatalog(source);
		const changed = vi.fn();
		catalog.subscribe(changed);

		catalog.dispose();
		source.set([toolContribution("kilo.terminal/list")]);

		expect(changed).not.toHaveBeenCalled();
		expect(catalog.tools).toEqual([]);
	});
});

describe("mcpToolName", () => {
	it("drops the desktop_ prefix Kilo adds for its desktop MCP server", () => {
		expect(mcpToolName("kilo.environments/conda.envs-list")).toBe("environments_conda_envs_list");
	});
});
