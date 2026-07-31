import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalApiError } from "@anaconda-agentic-desktop/contracts";

import { createBrowserLocalApi } from "./browserLocalApi";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createBrowserLocalApi", () => {
	it("lists, adds, and toggles in-memory todos", async () => {
		const api = createBrowserLocalApi();
		expect(await api.todos.list()).toEqual([]);

		const created = await api.todos.add({ title: "  Buy milk  " });
		expect(created).toMatchObject({ title: "Buy milk", completed: false });
		expect(await api.todos.list()).toEqual([created]);

		const toggled = await api.todos.toggle({ id: created.id });
		expect(toggled.completed).toBe(true);
		expect(await api.todos.list()).toEqual([toggled]);
	});

	it("seeds from initial todos", async () => {
		const api = createBrowserLocalApi({
			todos: [{ id: "1", title: "seeded", completed: true }],
		});
		expect(await api.todos.list()).toEqual([{ id: "1", title: "seeded", completed: true }]);
	});

	it("rejects blank titles and unknown todo ids", async () => {
		const api = createBrowserLocalApi();
		await expect(api.todos.add({ title: "   " })).rejects.toMatchObject({
			name: "LocalApiError",
			code: "VALIDATION",
		});
		await expect(api.todos.toggle({ id: "missing" })).rejects.toBeInstanceOf(LocalApiError);
	});

	it("treats theme sync as a no-op outside Electron", async () => {
		const api = createBrowserLocalApi();
		await expect(
			api.theme.sync({ source: "dark", shouldUseDarkColors: true }),
		).resolves.toBeUndefined();
	});

	it("opens external URLs and copies text", async () => {
		const open = vi.fn(() => ({}) as Window);
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("open", open);
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		const api = createBrowserLocalApi();
		await expect(api.shell.openExternal({ url: "https://example.com" })).resolves.toEqual({
			opened: true,
		});
		expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");

		await api.shell.copyText({ text: "hello" });
		expect(writeText).toHaveBeenCalledWith("hello");
	});

	it("throws TRANSPORT errors when shell operations fail", async () => {
		vi.stubGlobal(
			"open",
			vi.fn(() => null),
		);
		vi.stubGlobal("navigator", {
			clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
		});

		const api = createBrowserLocalApi();
		await expect(api.shell.openExternal({ url: "https://example.com" })).rejects.toMatchObject({
			code: "TRANSPORT",
		});
		await expect(api.shell.copyText({ text: "hello" })).rejects.toMatchObject({
			code: "TRANSPORT",
		});
	});

	it("falls back when crypto.randomUUID is unavailable", async () => {
		vi.stubGlobal("crypto", {});
		const api = createBrowserLocalApi();
		const created = await api.todos.add({ title: "no-uuid" });
		expect(created.id).toMatch(/^todo-/);
		vi.unstubAllGlobals();
	});
});
