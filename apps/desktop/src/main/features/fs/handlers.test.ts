import { describe, expect, it, vi } from "vitest";

import { createFsHandlers } from "./handlers.js";

describe("createFsHandlers", () => {
	it("maps every fs channel onto the scoped fs service", async () => {
		const fs = {
			readFile: vi.fn(async () => "content"),
			writeFile: vi.fn(async () => undefined),
			exists: vi.fn(async () => true),
			mkdir: vi.fn(async () => undefined),
			readdir: vi.fn(async () => ["a.txt"]),
			remove: vi.fn(async () => undefined),
		};

		const handlers = createFsHandlers(fs as never);
		const scope = { featureId: "todos", path: "notes/a.txt" };

		await expect(handlers["fs:read-file"](scope)).resolves.toEqual({ content: "content" });
		expect(fs.readFile).toHaveBeenCalledWith("todos", "notes/a.txt");

		await expect(handlers["fs:write-file"]({ ...scope, content: "hi" })).resolves.toBeUndefined();
		expect(fs.writeFile).toHaveBeenCalledWith("todos", "notes/a.txt", "hi");

		await expect(handlers["fs:exists"](scope)).resolves.toEqual({ exists: true });
		await expect(handlers["fs:mkdir"](scope)).resolves.toBeUndefined();
		await expect(handlers["fs:readdir"](scope)).resolves.toEqual({ entries: ["a.txt"] });
		await expect(handlers["fs:remove"](scope)).resolves.toBeUndefined();
		expect(fs.remove).toHaveBeenCalledWith("todos", "notes/a.txt");
	});
});
