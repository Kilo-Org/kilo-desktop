import type { SessionInfo } from "@kilocode/client";
import { describe, expect, it, vi } from "vitest";

import { createOpenCodeThreadListAdapter } from "./openCodeThreadListAdapter";
import { createFakeClient, createFakeEventSource, session } from "./testUtils";
import type { OpenCodeRuntimeBackend } from "./types";

function setup(
	overrides: Partial<OpenCodeRuntimeBackend> = {},
	titles: Record<string, string> = {},
) {
	const fake = createFakeClient();
	const backend: OpenCodeRuntimeBackend = {
		client: fake.client,
		initializeSession: vi.fn(async () => ({ id: "ses_new" })),
		createEventSource: () => ({ ...createFakeEventSource(), dispose: () => undefined }),
		...overrides,
	};
	const adapter = createOpenCodeThreadListAdapter(backend, (sessionId) => titles[sessionId]);
	return { fake, backend, adapter };
}

const page = (count: number, offset = 0) =>
	Array.from({ length: count }, (_, index) =>
		session(`ses_${offset + index}`, { title: `Chat ${offset + index}` }),
	);

const untitled = ({ title: _title, ...rest }: SessionInfo): SessionInfo => rest;

describe("createOpenCodeThreadListAdapter", () => {
	it("lists root sessions page by page, following session.list's cursor", async () => {
		const { fake, adapter } = setup();
		fake.session.list
			.mockResolvedValueOnce({ data: page(100), cursor: { next: "cur_2" } })
			.mockResolvedValueOnce({ data: page(3, 100), cursor: { next: "cur_3" } });

		const first = await adapter.list();
		expect(fake.session.list).toHaveBeenLastCalledWith({ parentID: null, limit: 100 });
		expect(first.threads).toHaveLength(100);
		expect(first.nextCursor).toBe("cur_2");

		const second = await adapter.list({ after: "cur_2" });
		expect(fake.session.list).toHaveBeenLastCalledWith({ cursor: "cur_2", limit: 100 });
		expect(second.threads.map((thread) => thread.remoteId)).toEqual([
			"ses_100",
			"ses_101",
			"ses_102",
		]);
		expect(second).not.toHaveProperty("nextCursor");
	});

	it("maps a session to a thread, archived when it has an archive time", async () => {
		const { fake, adapter } = setup();
		fake.session.list.mockResolvedValueOnce({
			data: [
				session("ses_1", { title: "Fix" }),
				untitled(session("ses_2", { time: { created: 1, updated: 1, archived: 5 } })),
			],
			cursor: {},
		});

		expect((await adapter.list()).threads).toEqual([
			{ status: "regular", remoteId: "ses_1", externalId: "ses_1", title: "Fix" },
			{ status: "archived", remoteId: "ses_2", externalId: "ses_2", title: "" },
		]);
	});

	it("forwards paging to the host's own listing, dropping child sessions", async () => {
		const listSessionPage = vi.fn(async () => ({
			sessions: [session("ses_1"), session("ses_child", { parentID: "ses_1" })],
			nextCursor: "next",
		}));
		const { fake, adapter } = setup({ listSessionPage });

		const result = await adapter.list({ after: "c1" });

		expect(listSessionPage).toHaveBeenCalledWith({ after: "c1" });
		expect(result.threads.map((thread) => thread.remoteId)).toEqual(["ses_1"]);
		expect(result.nextCursor).toBe("next");
		expect(fake.session.list).not.toHaveBeenCalled();
	});

	it("renames, archives, unarchives and deletes through the session", async () => {
		const { fake, adapter } = setup();

		await adapter.rename("ses_1", "New title");
		await adapter.archive("ses_1");
		await adapter.unarchive("ses_1");
		await adapter.delete("ses_1");

		expect(fake.session.update.mock.calls.map(([input]) => input)).toEqual([
			{ sessionID: "ses_1", title: "New title" },
			{ sessionID: "ses_1", archived: true },
			{ sessionID: "ses_1", archived: false },
		]);
		expect(fake.session.remove).toHaveBeenCalledWith({ sessionID: "ses_1" });
	});

	it("doesn't echo the session's own title back as a rename", async () => {
		const { fake, adapter } = setup({}, { ses_1: "Fix the build " });

		await adapter.rename("ses_1", "Fix the build");

		expect(fake.session.update).not.toHaveBeenCalled();
	});

	it("streams the session's own title as the generated one, or nothing", async () => {
		const { adapter } = setup({}, { ses_1: " Fix the build " });
		const read = async (stream: ReadableStream<unknown>) => {
			const chunks: unknown[] = [];
			for await (const chunk of stream as unknown as AsyncIterable<unknown>) chunks.push(chunk);
			return chunks;
		};

		expect(await read(await adapter.generateTitle("ses_1"))).toContainEqual({
			type: "text-delta",
			path: [0],
			textDelta: "Fix the build",
		});
		expect(await read(await adapter.generateTitle("ses_unknown"))).toEqual([]);
	});

	it("creates a thread's session through the backend and fetches one by id", async () => {
		const { fake, adapter } = setup();
		fake.sessions.set("ses_9", session("ses_9", { title: "Nine" }));

		await expect(adapter.initialize()).resolves.toEqual({
			remoteId: "ses_new",
			externalId: "ses_new",
		});
		await expect(adapter.fetch("ses_9")).resolves.toMatchObject({
			remoteId: "ses_9",
			title: "Nine",
		});
	});

	it("propagates server errors", async () => {
		const { fake, adapter } = setup();
		const error = new Error("Unauthorized");
		fake.session.list.mockRejectedValueOnce(error);
		fake.session.update.mockRejectedValueOnce(error);

		await expect(adapter.list()).rejects.toBe(error);
		await expect(adapter.rename("ses_1", "x")).rejects.toBe(error);
	});
});
