import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BusinessError } from "../../platform/BusinessError.js";
import { createDatabase } from "../../platform/db/client.js";
import { TodoService } from "./TodoService.js";

const migrationsFolder = path.resolve(import.meta.dirname, "../../../../drizzle");

describe("TodoService", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0)) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("persists todos through drizzle/sqlite", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "todos-db-"));
		directories.push(directory);
		const dbPath = path.join(directory, "app.db");

		const first = new TodoService(createDatabase(dbPath, migrationsFolder));
		const created = first.add("Write tests");
		expect(created).toMatchObject({ title: "Write tests", completed: false });
		expect(first.list()).toEqual([created]);

		const toggled = first.toggle(created.id);
		expect(toggled.completed).toBe(true);

		const second = new TodoService(createDatabase(dbPath, migrationsFolder));
		expect(second.list()).toEqual([toggled]);
	});

	it("throws when toggling a missing todo", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "todos-db-"));
		directories.push(directory);
		const service = new TodoService(
			createDatabase(path.join(directory, "app.db"), migrationsFolder),
		);
		expect(() => service.toggle("missing")).toThrow(BusinessError);
	});
});
