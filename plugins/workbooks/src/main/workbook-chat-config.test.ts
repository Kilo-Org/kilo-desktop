import { afterEach, describe, expect, it } from "vitest";

import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import { ChatConfigPoint, type ChatConfigContext } from "@kilo-desktop/plugin-core/contracts";

import { SessionWorkbooks, Workbooks } from "../contracts";
import { FakePages } from "../test/fake-pages";
import { bootWorkbooks } from "../test/hosts";

const hosts: PluginHost[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

async function boot(pages = new FakePages()) {
	const booted = await bootWorkbooks({ pages });
	hosts.push(booted.host);
	const { host } = booted;
	const create = (name: string) =>
		host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name,
			values: { goal: `Goal of ${name}` },
		});
	const configs = () => host.main.kernelSdk.extensions.list(ChatConfigPoint);
	const configure = async (context: Partial<ChatConfigContext>) => {
		await expect
			.poll(() => configs().some((config) => config.key === "kilo.workbooks/workbook"))
			.toBe(true);
		const config = configs().find((candidate) => candidate.key === "kilo.workbooks/workbook")!;
		return config.implementation!.configure({
			chatId: "chat_1",
			directory: "/repo",
			workSessionId: "wses_1",
			workspaceId: "ws-1",
			...context,
		});
	};
	const putInWorkbook = (workbookId: string | null, workSessionId = "wses_1") =>
		host.invoke(SessionWorkbooks, "setActive", { workSessionId, workbookId });
	return { ...booted, create, configure, putInWorkbook };
}

describe("chats in a work session on a workbook", () => {
	it("are given the workbook, its Brief and its guide as instructions", async () => {
		const { create, configure, putInWorkbook } = await boot();
		const workbook = await create("Clock");
		await putInWorkbook(workbook.id);

		const config = await configure({});

		expect(config.instructions).toHaveLength(1);
		const [text] = config.instructions!;
		expect(text).toContain('works in the workbook "Clock"');
		expect(text).toContain(`Pages project id ${workbook.projectId}`);
		expect(text).toContain("make the guide's first move");
		expect(text).toContain("## Brief\n\n## Where I left off");
		expect(text).toContain("Goal of Clock");
		expect(text).toContain("## How to work here\n\nThis is the agent guide");
	});

	it("read Pages once per chat, again for another chat or workbook", async () => {
		const { create, configure, putInWorkbook, pages } = await boot();
		const first = await create("First");
		const second = await create("Second");
		await putInWorkbook(first.id);
		const reads = () => pages.calls.filter((call) => call.tool === "read_page").length;

		const before = reads();
		await configure({});
		const once = reads() - before;
		expect(once).toBeGreaterThan(0);
		await configure({});
		expect(reads()).toBe(before + once);

		await configure({ chatId: "chat_2" });
		expect(reads()).toBe(before + once * 2);

		await putInWorkbook(second.id);
		expect((await configure({})).instructions![0]).toContain('"Second"');
	});

	it("give nothing outside a workbook, or before the chat exists", async () => {
		const { create, configure, putInWorkbook } = await boot();
		await putInWorkbook((await create("Clock")).id);

		await expect(configure({ workSessionId: "wses_other" })).resolves.toEqual({});
		await expect(configure({ workSessionId: null })).resolves.toEqual({});
		await expect(configure({ chatId: null })).resolves.toEqual({});
	});

	it("point at the Brief and guide when Pages can't be read", async () => {
		const pages = new FakePages();
		const { create, configure, putInWorkbook } = await boot(pages);
		await putInWorkbook((await create("Clock")).id);
		pages.failOn = "read_page";

		const [text] = (await configure({})).instructions!;

		expect(text).toContain("Read the Brief (the project document) first.");
		expect(text).toContain('Read the "How to work here" page before anything else.');
	});
});
