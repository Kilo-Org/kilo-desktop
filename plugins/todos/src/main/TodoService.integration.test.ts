import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk/main";

import { createTodosDatabase, resolveTodosMigrationsFolder, type TodosDatabase } from "./db.js";
import { TodoService } from "./TodoService.js";

describe("TodoService", () => {
	const directories: string[] = [];
	const databases: TodosDatabase[] = [];

	afterEach(() => {
		for (const db of databases.splice(0)) {
			db.$client.close();
		}
		for (const directory of directories.splice(0)) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	function tempDirectory(): string {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "todos-db-"));
		directories.push(directory);
		return directory;
	}

	function openService(directory: string): TodoService {
		const db = createTodosDatabase(path.join(directory, "data.db"));
		databases.push(db);
		return new TodoService(db);
	}

	it("persists todos to the feature-owned database", () => {
		const directory = tempDirectory();

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

	it("throws FeatureError NOT_FOUND when toggling a missing todo", () => {
		const service = openService(tempDirectory());
		expect(() => service.toggle("missing")).toThrowError(FeatureError);
		expect(() => service.toggle("missing")).toThrowError("Todo not found.");
		try {
			service.toggle("missing");
		} catch (error) {
			expect(error).toMatchObject({ code: "NOT_FOUND" });
		}
	});
});

describe("resolveTodosMigrationsFolder", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0)) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("uses the plugin-root drizzle folder when present", () => {
		expect(resolveTodosMigrationsFolder()).toBe(path.resolve(import.meta.dirname, "../../drizzle"));
	});

	it("falls back to the deployed package path when running from the app bundle", () => {
		// Bundled main.js lives at <app>/.vite/build — no plugin-root drizzle/.
		const bundleDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "todos-bundle-"));
		directories.push(bundleDirectory);
		expect(resolveTodosMigrationsFolder(bundleDirectory)).toBe(
			path.resolve(
				bundleDirectory,
				"../../node_modules/@anaconda-agentic-desktop/plugin-todos/drizzle",
			),
		);
	});
});
