import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BusinessError } from "../../platform/BusinessError.js";
import { createDatabase, type AppDatabase } from "../../platform/db/client.js";
import { TodoService } from "./TodoService.js";

const migrationsFolder = path.resolve(import.meta.dirname, "../../../../drizzle");

describe("TodoService", () => {
	const directories: string[] = [];
	const databases: AppDatabase[] = [];

	afterEach(() => {
		for (const db of databases.splice(0)) {
			db.$client.close();
		}
		for (const directory of directories.splice(0)) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	function openService(directory: string): TodoService {
		const db = createDatabase(path.join(directory, "app.db"), migrationsFolder);
		databases.push(db);
		return new TodoService(db);
	}

	it("persists todos through drizzle/sqlite", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "todos-db-"));
		directories.push(directory);

		const first = openService(directory);
		const created = first.add("Write tests");
		expect(created).toMatchObject({ title: "Write tests", completed: false });
		expect(first.list()).toEqual([created]);

		const toggled = first.toggle(created.id);
		expect(toggled.completed).toBe(true);

		// Close before reopening the same path so Windows releases the file lock.
		for (const db of databases.splice(0)) {
			db.$client.close();
		}
		const second = openService(directory);
		expect(second.list()).toEqual([toggled]);
	});

	it("throws when toggling a missing todo", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "todos-db-"));
		directories.push(directory);
		const service = openService(directory);
		expect(() => service.toggle("missing")).toThrow(BusinessError);
	});
});
