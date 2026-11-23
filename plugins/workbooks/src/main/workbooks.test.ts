import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";
import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import {
	SessionWorkbooks,
	Workbooks,
	workbooksFor,
	type AddWorkbookInput,
	type Workbook,
} from "../contracts";
import { FakePages } from "../test/fake-pages";
import { bootWorkbooks, workSession } from "../test/hosts";

const hosts: PluginHost[] = [];

afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

async function boot(
	storage = createMemoryStorage("/memory/kilo.workbooks"),
	pages = new FakePages(),
	options: Omit<Parameters<typeof bootWorkbooks>[0] & {}, "storage" | "pages"> = {},
) {
	const { host, directories } = await bootWorkbooks({ ...options, storage, pages });
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
	sections: [
		{
			id: "plan",
			title: "Steps",
			type: "steps",
			role: "plan",
			pageId: "page-plan",
			heading: "Steps",
		},
	],
	...overrides,
});

describe("workbooks", () => {
	it("adds a workbook, used in the workspace it was added in", async () => {
		const { host, workbooks } = await boot();

		const added = await host.invoke(Workbooks, "add", input());

		const { workspaceId: _, ...reference } = input();
		expect(added).toMatchObject({ ...reference, id: "prj_1" });
		expect(Date.parse(added.createdAt)).not.toBeNaN();
		expect(added.lastUsedAt).toBe(added.createdAt);
		expect(added.usedIn).toEqual([{ workspaceId: "ws-1", lastUsedAt: added.createdAt }]);
		await expect.poll(() => workbooks.getState().workbooks).toEqual([added]);
		expect(workbooks.lookup(added.id)).toEqual(added);
	});

	it("adds a workbook outside any workspace", async () => {
		const { host } = await boot();

		const added = await host.invoke(Workbooks, "add", input({ workspaceId: null }));

		expect(added.usedIn).toEqual([]);
	});

	it("keeps workbooks across restarts", async () => {
		const first = await boot();
		const added = await first.host.invoke(Workbooks, "add", input());
		await first.host.dispose();
		hosts.splice(hosts.indexOf(first.host), 1);

		const second = await boot(first.storage);

		expect(second.workbooks.getState().workbooks).toEqual([added]);
	});

	it("reads workbooks saved while they belonged to one workspace as used there", async () => {
		const storage = createMemoryStorage("/memory/kilo.workbooks");
		const { workspaceId: _, ...reference } = input();
		storage.kv({ namespace: "workbooks", defaults: { workbooks: [] as unknown[] } }).set({
			workbooks: [
				{ ...reference, id: "old", workspaceId: "ws-1", createdAt: "2026-11-16T00:00:00.000Z" },
			],
		});

		const { workbooks } = await boot(storage);

		expect(workbooks.getState().workbooks).toEqual([
			{
				...reference,
				id: "prj_1",
				createdAt: "2026-11-16T00:00:00.000Z",
				lastUsedAt: "2026-11-16T00:00:00.000Z",
				usedIn: [{ workspaceId: "ws-1", lastUsedAt: "2026-11-16T00:00:00.000Z" }],
			},
		]);
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
	it("copies the template into Pages and records it as used in its workspace", async () => {
		const { host, pages, workbooks } = await boot();

		const created = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Fix the server bug",
			values: { goal: "Fix the bug in the Kilo server" },
		});

		expect(created).toMatchObject({
			name: "Fix the server bug",
			templateId: "coding",
			backend: { kind: "pages-mcp", server: "pages" },
			usedIn: [{ workspaceId: "ws-1", lastUsedAt: created.createdAt }],
		});
		expect(created.id).toBe(created.projectId);
		expect(pages.projects.get(created.projectId)?.description).toBe("Workbook · Coding (coding)");
		expect(created.sections).toHaveLength(11);
		await expect.poll(() => workbooks.getState().workbooks).toEqual([created]);
	});

	it("creates a workbook outside any workspace", async () => {
		const { host, pages } = await boot();

		const created = await host.invoke(Workbooks, "create", {
			workspaceId: null,
			templateId: "blank",
			name: "Scratch",
			values: { goal: "Trying things out" },
		});

		expect(created.usedIn).toEqual([]);
		expect(pages.projects.get(created.projectId)?.description).toBe("Workbook · Blank (blank)");
	});

	it("reaches Pages through Kilo's global MCP connection by default", async () => {
		const { host, pages, directories } = await bootWorkbooks({ viaKilo: true });
		hosts.push(host);

		const created = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Via Kilo",
			values: { goal: "g" },
		});

		expect(pages.projects.get(created.projectId)?.title).toBe("Via Kilo");
		expect(new Set(directories)).toEqual(new Set(["/runtime"]));
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

describe("finding workbooks in Pages", () => {
	it("lists the marked Projects, made anywhere, and keeps where they were used", async () => {
		const pages = new FakePages();
		const elsewhere = pages.addProject("From the old laptop", "Workbook · Coding · workspace: W", [
			"How to work here",
			"Plan",
		]);
		pages.addProject("Holiday plans", "Not a workbook");
		const { host, workbooks } = await boot(undefined, pages);
		const made = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "blank",
			name: "Made here",
			values: { goal: "g" },
		});

		await host.invoke(Workbooks, "refresh", undefined);

		const state = workbooks.getState();
		expect(state).toMatchObject({ refreshing: false, refreshError: null });
		expect(state.workbooks.map((workbook) => workbook.id)).toEqual([elsewhere, made.id]);
		expect(state.workbooks[0]).toMatchObject({
			name: "From the old laptop",
			templateId: "coding",
			usedIn: [],
		});
		expect(state.workbooks[0]!.sections.find((section) => section.id === "plan")).toMatchObject({
			heading: "Steps",
		});
		expect(state.workbooks[1]).toEqual(made);
	});

	it("drops workbooks no longer in Pages", async () => {
		const pages = new FakePages();
		const { host, workbooks } = await boot(undefined, pages);
		const made = await host.invoke(Workbooks, "create", {
			workspaceId: null,
			templateId: "blank",
			name: "Soon deleted",
			values: { goal: "g" },
		});
		pages.projects.delete(made.projectId);

		await host.invoke(Workbooks, "refresh", undefined);

		expect(workbooks.getState().workbooks).toEqual([]);
	});

	it("keeps the list it had, and says why, when Pages can't be read", async () => {
		const pages = new FakePages();
		const { host, workbooks } = await boot(undefined, pages);
		const added = await host.invoke(Workbooks, "add", input());
		pages.failOn = "list_projects";

		await expect(host.invoke(Workbooks, "refresh", undefined)).resolves.toBeUndefined();

		expect(workbooks.getState()).toMatchObject({
			workbooks: [added],
			refreshing: false,
			refreshError: expect.stringContaining("list_projects failed"),
		});
	});

	it("shares one refresh between callers, and keeps a workbook created while it lists", async () => {
		const pages = new FakePages();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const call = pages.call.bind(pages);
		pages.call = async (tool, args) => {
			if (tool === "list_projects") await gate;
			return call(tool, args);
		};
		const { host, workbooks } = await boot(undefined, pages);

		const first = host.invoke(Workbooks, "refresh", undefined);
		const second = host.invoke(Workbooks, "refresh", undefined);
		await expect.poll(() => workbooks.getState().refreshing).toBe(true);
		const listing = pages.calls.length;
		const made = await host.invoke(Workbooks, "create", {
			workspaceId: null,
			templateId: "blank",
			name: "Made meanwhile",
			values: { goal: "g" },
		});
		pages.projects.delete(made.projectId);
		release();
		await Promise.all([first, second]);

		expect(
			pages.calls.slice(listing).filter((entry) => entry.tool === "list_projects"),
		).toHaveLength(1);
		expect(workbooks.getState().workbooks.map((workbook) => workbook.id)).toEqual([made.id]);
	});

	it("reads workbooks and sessions saved under the old random ids by their project id", async () => {
		const storage = createMemoryStorage("/memory/kilo.workbooks");
		const { workspaceId: _, ...reference } = input();
		storage.kv({ namespace: "workbooks", defaults: { workbooks: [] as unknown[] } }).set({
			workbooks: [
				{
					...reference,
					id: "6b0c-random",
					createdAt: "2026-11-16T00:00:00.000Z",
					lastUsedAt: "2026-11-16T00:00:00.000Z",
					usedIn: [],
				},
			],
		});
		storage
			.kv({ namespace: "session-workbooks", defaults: { bySession: {} as Record<string, string> } })
			.set({ bySession: { wses_old: "6b0c-random" } });

		const { host, workbooks } = await boot(storage);

		expect(workbooks.getState().workbooks.map((workbook) => workbook.id)).toEqual(["prj_1"]);
		const sessions = host.renderer.kernelSdk.domainObjects.get(SessionWorkbooks)!;
		expect(sessions.getState().bySession).toEqual({ wses_old: "prj_1" });
	});
});

describe("using a workbook in a work session", () => {
	it("records the session's workspace, and when it was last used", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-11-17T10:00:00.000Z"));
		const { host, workbooks } = await boot(undefined, undefined, {
			sessions: [workSession("wses_a", "ws-2"), workSession("wses_b")],
		});
		const added = await host.invoke(Workbooks, "add", input());
		const current = () => workbooks.getState().workbooks.find((entry) => entry.id === added.id);

		vi.setSystemTime(new Date("2026-11-17T11:00:00.000Z"));
		await host.invoke(SessionWorkbooks, "setActive", {
			workSessionId: "wses_a",
			workbookId: added.id,
		});

		await expect
			.poll(() => current()?.usedIn)
			.toEqual([
				{ workspaceId: "ws-1", lastUsedAt: "2026-11-17T10:00:00.000Z" },
				{ workspaceId: "ws-2", lastUsedAt: "2026-11-17T11:00:00.000Z" },
			]);
		expect(current()?.lastUsedAt).toBe("2026-11-17T11:00:00.000Z");

		vi.setSystemTime(new Date("2026-11-17T12:00:00.000Z"));
		await host.invoke(SessionWorkbooks, "setActive", {
			workSessionId: "wses_b",
			workbookId: added.id,
		});

		await expect.poll(() => current()?.lastUsedAt).toBe("2026-11-17T12:00:00.000Z");
		expect(current()?.usedIn.map((use) => use.workspaceId)).toEqual(["ws-1", "ws-2"]);
	});
});

describe("workbooksFor", () => {
	const workbook = (id: string, lastUsedAt: string, usedIn: Record<string, string> = {}) =>
		({
			id,
			lastUsedAt,
			usedIn: Object.entries(usedIn).map(([workspaceId, at]) => ({ workspaceId, lastUsedAt: at })),
		}) as Workbook;

	const all = [
		workbook("a", "2026-01-05T00:00:00Z", {
			"ws-1": "2026-01-01T00:00:00Z",
			"ws-2": "2026-01-05T00:00:00Z",
		}),
		workbook("b", "2026-01-02T00:00:00Z", { "ws-2": "2026-01-02T00:00:00Z" }),
		workbook("c", "2026-01-03T00:00:00Z", { "ws-1": "2026-01-03T00:00:00Z" }),
		workbook("d", "2026-01-04T00:00:00Z"),
	];
	const ids = (list: readonly Workbook[]) => list.map((entry) => entry.id);

	it("puts the workspace's workbooks first, by when they were last used there, then the rest", () => {
		const { here, elsewhere } = workbooksFor(all, "ws-1");

		expect(ids(here)).toEqual(["c", "a"]);
		expect(ids(elsewhere)).toEqual(["d", "b"]);
	});

	it("lists every workbook by when it was last used without a workspace", () => {
		const { here, elsewhere } = workbooksFor(all, null);

		expect(here).toEqual([]);
		expect(ids(elsewhere)).toEqual(["a", "d", "c", "b"]);
	});
});
