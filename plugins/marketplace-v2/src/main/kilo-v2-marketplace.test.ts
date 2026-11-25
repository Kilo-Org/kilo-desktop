import { describe, expect, it } from "vitest";

import { FakeV2Marketplace } from "../test/fake-v2-marketplace";
import { KiloV2Marketplace, toMcpStatus } from "./kilo-v2-marketplace";

describe("KiloV2Marketplace", () => {
	it("renders an MCP without options as one configuration, its parameters as placeholders", async () => {
		const kilo = new FakeV2Marketplace();
		kilo.catalog = [
			{
				registry: "kilo",
				kind: "mcp",
				id: "keys",
				name: "Keys",
				description: "d",
				url: "not a url",
				prerequisites: [],
				parameters: [{ key: "TOKEN", name: "Token", optional: false, secret: true }],
				options: [],
			},
		];
		kilo.templates.keys = '{"type":"local","command":["x"],"environment":{"TOKEN":"{{TOKEN}}"}}';

		const [item] = (await new KiloV2Marketplace(kilo).list("/g")).items;

		expect(item).toMatchObject({
			type: "mcp",
			category: "other",
			url: "https://github.com/Kilo-Org/kilo-marketplace",
			parameters: [{ key: "TOKEN", name: "Token", optional: false }],
			content: '{"type":"local","command":["x"],"environment":{"TOKEN":"{{TOKEN}}"}}',
		});
		expect(kilo.callsTo("preview")[0]?.[2]).toMatchObject({
			scope: "global",
			params: { TOKEN: "{{TOKEN}}" },
		});
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
		kilo.servers = [{ name: "gh", status: { status: "needs_auth" }, integrationID: "mcp:gh" }];
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

	it("maps v2's MCP statuses onto the contract's", () => {
		expect(toMcpStatus({ status: "connected" })).toEqual({ status: "connected" });
		expect(toMcpStatus({ status: "needs_auth", error: "x" })).toEqual({ status: "needs_auth" });
		expect(toMcpStatus({ status: "pending" })).toMatchObject({ status: "failed" });
		expect(toMcpStatus({ status: "failed", error: "boom" })).toEqual({
			status: "failed",
			error: "boom",
		});
	});
});
