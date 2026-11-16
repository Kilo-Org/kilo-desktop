import { afterEach, describe, expect, it } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";
import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import manifest from "../../plugin.json";
import {
	WORKBOOKS_DEFINITIONS,
	Workbooks,
	workbooksIn,
	type AddWorkbookInput,
	type Workbook,
} from "../contracts";
import { workbooksMainEntry } from "./index";

const hosts: PluginHost[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

async function boot(storage = createMemoryStorage("/memory/kilo.workbooks")) {
	const host = await createPluginHost(
		[{ manifest, definitions: WORKBOOKS_DEFINITIONS, main: workbooksMainEntry }],
		{ mainHostServices: () => ({ storage }) },
	);
	hosts.push(host);
	return { host, storage, workbooks: host.renderer.kernelSdk.domainObjects.get(Workbooks)! };
}

const input = (overrides: Partial<AddWorkbookInput> = {}): AddWorkbookInput => ({
	workspaceId: "ws-1",
	name: "Fix the server bug",
	templateId: "coding",
	backend: { kind: "pages-mcp", server: "pages" },
	projectId: "prj_1",
	guidePageId: "page-guide",
	sections: [{ id: "plan", title: "Plan", itemType: "plan-step", pageId: "page-plan" }],
	...overrides,
});

describe("workbooks", () => {
	it("adds a workbook to a workspace, with an id and creation time", async () => {
		const { host, workbooks } = await boot();

		const added = await host.invoke(Workbooks, "add", input());

		expect(added).toMatchObject({ ...input(), id: expect.any(String) });
		expect(Date.parse(added.createdAt)).not.toBeNaN();
		await expect.poll(() => workbooks.getState().workbooks).toEqual([added]);
		expect(workbooks.lookup(added.id)).toEqual(added);
	});

	it("keeps workbooks across restarts", async () => {
		const first = await boot();
		const added = await first.host.invoke(Workbooks, "add", input());
		await first.host.dispose();
		hosts.splice(hosts.indexOf(first.host), 1);

		const second = await boot(first.storage);

		expect(second.workbooks.getState().workbooks).toEqual([added]);
	});

	it("renames and forgets workbooks", async () => {
		const { host, workbooks } = await boot();
		const added = await host.invoke(Workbooks, "add", input());

		await expect(
			host.invoke(Workbooks, "rename", { id: added.id, name: " Renamed " }),
		).resolves.toMatchObject({
			name: "Renamed",
		});
		await expect(host.invoke(Workbooks, "forget", { id: added.id })).resolves.toEqual({
			forgotten: true,
		});
		await expect(host.invoke(Workbooks, "forget", { id: added.id })).resolves.toEqual({
			forgotten: false,
		});
		await expect(
			host.invoke(Workbooks, "rename", { id: added.id, name: "x" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect.poll(() => workbooks.getState().workbooks).toEqual([]);
	});

	it("drops saved workbooks that no longer match the schema", async () => {
		const storage = createMemoryStorage("/memory/kilo.workbooks");
		storage.kv({ namespace: "workbooks", defaults: { workbooks: [] as unknown[] } }).set({
			workbooks: [{ id: "broken" }],
		});

		const { workbooks } = await boot(storage);

		expect(workbooks.getState().workbooks).toEqual([]);
	});
});

describe("workbooksIn", () => {
	const workbook = (id: string, workspaceId: string, createdAt: string) =>
		({ ...input({ workspaceId }), id, createdAt }) as Workbook;

	it("lists one workspace's workbooks, newest first", () => {
		const all = [
			workbook("a", "ws-1", "2026-01-01T00:00:00Z"),
			workbook("b", "ws-2", "2026-01-02T00:00:00Z"),
			workbook("c", "ws-1", "2026-01-03T00:00:00Z"),
		];

		expect(workbooksIn(all, "ws-1").map((entry) => entry.id)).toEqual(["c", "a"]);
		expect(workbooksIn(all, null)).toEqual([]);
	});
});
