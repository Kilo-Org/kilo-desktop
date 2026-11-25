import { describe, expect, it } from "vitest";

import { catalogItem, FakeV2Marketplace } from "../test/fake-v2-marketplace";
import { KiloV2Marketplace, toMcpStatus } from "./kilo-v2-marketplace";

describe("KiloV2Marketplace", () => {
	it("renders an MCP without options as v2's preview, secrets redacted and other parameters as placeholders", async () => {
		const kilo = new FakeV2Marketplace();
		kilo.catalog = [
			catalogItem({
				kind: "mcp",
				id: "keys",
				name: "Keys",
				description: "d",
				url: "not a url",
				parameters: [
					{ key: "TOKEN", name: "Token", optional: false, secret: true },
					{ key: "REGION", name: "Region", optional: true },
				],
			}),
		];
		kilo.templates.keys = {
			type: "local",
			command: ["keys-mcp", "--region", "{{REGION}}"],
			environment: { TOKEN: "{{TOKEN}}" },
		};

		const [item] = (await new KiloV2Marketplace(kilo).list("/g")).items;

		expect(item).toMatchObject({
			type: "mcp",
			category: "other",
			url: "https://github.com/Kilo-Org/kilo-marketplace",
			parameters: [
				{ key: "TOKEN", name: "Token", optional: false },
				{ key: "REGION", name: "Region", optional: true },
			],
		});
		expect(item?.type === "mcp" && JSON.parse(item.content as string)).toEqual({
			type: "local",
			command: ["keys-mcp", "--region", "{{REGION}}"],
			environment: { TOKEN: "[redacted]" },
		});
		expect(kilo.callsTo("preview")[0]?.[2]).toMatchObject({
			scope: "global",
			params: { TOKEN: "{{TOKEN}}", REGION: "{{REGION}}" },
		});
	});

	it("renders each install option, and drops plugins and skills without a source", async () => {
		const kilo = new FakeV2Marketplace();
		kilo.catalog = [
			catalogItem({
				kind: "mcp",
				id: "docs",
				options: [
					{ name: "Local", prerequisites: ["Node.js"], parameters: [] },
					{
						name: "Remote",
						description: "Hosted",
						prerequisites: [],
						parameters: [{ key: "KEY", name: "Key", optional: false, secret: true }],
					},
				],
			}),
			catalogItem({ kind: "plugin", id: "p", plugin: { spec: "p@1" } }),
			catalogItem({ kind: "skill", id: "s" }),
		];
		kilo.templates["docs:Remote"] = {
			type: "remote",
			url: "https://docs.example/mcp",
			headers: { Authorization: "Bearer {{KEY}}" },
		};

		const { items } = await new KiloV2Marketplace(kilo).list("/g");

		expect(items.map((entry) => entry.id)).toEqual(["docs"]);
		const [docs] = items;
		expect(docs?.type === "mcp" && docs.content).toEqual([
			{
				name: "Local",
				content: JSON.stringify({ type: "local", command: ["docs"] }, null, 2),
				prerequisites: ["Node.js"],
			},
			{
				name: "Remote",
				content: JSON.stringify(
					{
						type: "remote",
						url: "https://docs.example/mcp",
						headers: { Authorization: "Bearer [redacted]" },
					},
					null,
					2,
				),
				parameters: [{ key: "KEY", name: "Key", optional: false }],
			},
		]);
	});

	it("resolves the config file an install wrote, relative to the scope root", async () => {
		const kilo = new FakeV2Marketplace();
		kilo.catalog = [catalogItem({ kind: "mcp", id: "docs" })];
		kilo.configFile = ".kilo/kilo.jsonc";
		const marketplace = new KiloV2Marketplace(kilo);
		const [item] = (await marketplace.list("/w")).items;

		await expect(marketplace.install("/w", item!, "project", undefined, undefined)).resolves.toBe(
			".kilo/kilo.jsonc",
		);
	});

	it("reports catalog failures and removes a skill Kilo can delete", async () => {
		const kilo = new FakeV2Marketplace();
		kilo.failures = [{ registry: "kilo", message: "offline" }];
		kilo.skillList = [{ id: "s", name: "s", path: "/cfg/skills/s/SKILL.md", content: "" }];
		kilo.removableSkillList = ["/cfg/skills/s/SKILL.md"];
		const marketplace = new KiloV2Marketplace(kilo);

		expect((await marketplace.list("/g")).errors).toEqual(["kilo: offline"]);
		await marketplace.remove("/g", { type: "skill", id: "s" }, "global");
		expect(kilo.callsTo("removeSkill")).toEqual([
			["removeSkill", "/g", { path: "/cfg/skills/s/SKILL.md" }],
		]);
		await expect(
			marketplace.remove("/g", { type: "skill", id: "other" }, "global"),
		).rejects.toThrow("can't remove");
	});

	it("waits for an MCP sign-in to finish, and fails an expired one", async () => {
		const kilo = new FakeV2Marketplace();
		kilo.servers = [
			{ name: "gh", status: { status: "needs_auth", error: "Sign in" }, integrationID: "mcp:gh" },
		];
		kilo.oauth.statuses = ["pending", "pending", "complete"];
		const waits: number[] = [];
		const marketplace = new KiloV2Marketplace(kilo);

		await marketplace.authenticateMcp(
			"/g",
			"gh",
			async () => true,
			async (ms) => void waits.push(ms),
		);
		expect(waits).toEqual([1000, 1000]);

		kilo.oauth.statuses = ["expired"];
		await expect(marketplace.authenticateMcp("/g", "gh", async () => true)).rejects.toThrow(
			"timed out",
		);
	});

	it("maps v2's MCP statuses onto the contract's, leaving still-connecting servers without one", async () => {
		expect(toMcpStatus({ status: "connected" })).toEqual({ status: "connected" });
		expect(toMcpStatus({ status: "disabled" })).toEqual({ status: "disabled" });
		expect(toMcpStatus({ status: "needs_auth", error: "Sign in to GitHub" })).toEqual({
			status: "needs_auth",
		});
		expect(toMcpStatus({ status: "pending" })).toBeUndefined();
		expect(toMcpStatus({ status: "failed", error: "boom" })).toEqual({
			status: "failed",
			error: "boom",
		});

		const kilo = new FakeV2Marketplace();
		kilo.servers = [
			{ name: "ready", status: { status: "connected" } },
			{ name: "starting", status: { status: "pending" } },
		];
		await expect(new KiloV2Marketplace(kilo).mcpStatuses("/g")).resolves.toEqual({
			servers: ["ready", "starting"],
			statuses: { ready: { status: "connected" } },
		});
	});
});
