import { afterEach, describe, expect, it } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";
import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import { Workbooks, workbooksIn, type AddWorkbookInput, type Workbook } from "../contracts";
import { FakePages } from "../test/fake-pages";
import { bootWorkbooks } from "../test/hosts";

const hosts: PluginHost[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

async function boot(
	storage = createMemoryStorage("/memory/kilo.workbooks"),
	pages = new FakePages(),
) {
	const { host, directories } = await bootWorkbooks({ storage, pages });
	hosts.push(host);
	return {
		host,
		storage,
		pages,
		directories,
		workbooks: host.renderer.kernelSdk.domainObjects.get(Workbooks)!,
	};
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

describe("creating a workbook", () => {
	it("copies the template into Pages through the workspace's folder and records it", async () => {
		const { host, pages, directories, workbooks } = await boot();

		const created = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Fix the server bug",
			values: { goal: "Fix the bug in the Kilo server" },
		});

		expect(created).toMatchObject({
			workspaceId: "ws-1",
			name: "Fix the server bug",
			templateId: "coding",
			backend: { kind: "pages-mcp", server: "pages" },
		});
		expect(directories).toEqual(["/repo"]);
		expect(pages.projects.get(created.projectId)?.description).toBe(
			"Workbook · Coding · workspace: Kilo Desktop",
		);
		expect(created.sections).toHaveLength(10);
		await expect.poll(() => workbooks.getState().workbooks).toEqual([created]);
	});

	it("reaches Pages through Kilo's MCP connection by default", async () => {
		const { host, pages, directories } = await bootWorkbooks({ viaKilo: true });
		hosts.push(host);

		const created = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Via Kilo",
			values: { goal: "g" },
		});

		expect(pages.projects.get(created.projectId)?.title).toBe("Via Kilo");
		expect(new Set(directories)).toEqual(new Set(["/repo"]));
	});

	it("records nothing when Pages fails, and refuses unknown templates and workspaces", async () => {
		const pages = new FakePages();
		pages.failOn = "create_page";
		const { host, workbooks } = await boot(undefined, pages);
		const create = (overrides: Record<string, string> = {}) =>
			host.invoke(Workbooks, "create", {
				workspaceId: "ws-1",
				templateId: "coding",
				name: "x",
				values: { goal: "g" },
				...overrides,
			});

		await expect(create()).rejects.toThrow();
		await expect(create({ templateId: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(create({ workspaceId: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
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
