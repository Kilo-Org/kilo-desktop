import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createWorkspacesDatabase } from "./db.js";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../../drizzle");

describe("createWorkspacesDatabase", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0)) {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("recovers when the initial migration was interrupted after creating a table", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workspaces-migration-"));
		directories.push(directory);
		const dbPath = path.join(directory, "data.db");
		const interrupted = new Database(dbPath);
		interrupted.exec(`
			CREATE TABLE workspace_folders (
				id text PRIMARY KEY NOT NULL,
				workspace_id text NOT NULL,
				path text NOT NULL,
				is_primary integer NOT NULL,
				position integer NOT NULL,
				FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE cascade
			)
		`);
		interrupted.close();

		const db = createWorkspacesDatabase(dbPath, MIGRATIONS);
		const tables = db.$client
			.prepare(
				"select name from sqlite_master where type = 'table' and name in ('workspaces', 'workspace_folders') order by name",
			)
			.all();
		expect(tables).toEqual([{ name: "workspace_folders" }, { name: "workspaces" }]);
		const journal = JSON.parse(
			fs.readFileSync(path.join(MIGRATIONS, "meta/_journal.json"), "utf8"),
		) as { entries: unknown[] };
		expect(db.$client.prepare("select count(*) as count from __drizzle_migrations").get()).toEqual({
			count: journal.entries.length,
		});
		db.$client.close();
	});
});
