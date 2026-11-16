import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";

import { bootWorkSessions, chat, FakeCore, type MemoryStorage } from "../test-boot";

/*
 * Upgrading from origin on the same profile: origin's kilo-ui data.db holds
 * the workspaces and work sessions (chat links only), each
 * chat's server metadata names its workspace, and archives live on the chats.
 * Both launches must keep every work session in its workspace and archived
 * where its chat is, whether the chat list arrives before or after the import.
 */

let root: string;
beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "kilo-origin-upgrade-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const COPY = "/projects/app/.kilo/worktrees/brave-fox";

/** Origin's kilo-ui data.db after all its migrations, with this profile's data. */
function originDatabase(): string {
	const file = path.join(root, "data.db");
	const db = new Database(file);
	db.exec(`
		CREATE TABLE workspaces (id text PRIMARY KEY NOT NULL, name text NOT NULL, color text,
			created_at integer NOT NULL, updated_at integer NOT NULL);
		CREATE TABLE workspace_folders (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL,
			path text NOT NULL, is_primary integer NOT NULL, position integer NOT NULL);
		CREATE TABLE sessions (id text PRIMARY KEY NOT NULL, created_at integer NOT NULL);
		CREATE TABLE session_chats (kilo_session_id text PRIMARY KEY NOT NULL,
			session_id text NOT NULL, created_at integer NOT NULL);
		INSERT INTO workspaces VALUES ('w-app', 'App', '#34D399', 1, 1), ('w-lib', 'Lib', NULL, 2, 2);
		INSERT INTO workspace_folders VALUES
			('f-app', 'w-app', '/projects/app', 1, 0), ('f-lib', 'w-lib', '/projects/lib', 1, 0);
		INSERT INTO sessions VALUES
			('wses_live', 10), ('wses_archived', 11), ('wses_lib', 12), ('wses_unscoped', 13),
			('wses_copy', 14), ('wses_two', 15);
		INSERT INTO session_chats VALUES
			('ses_live', 'wses_live', 10), ('ses_archived', 'wses_archived', 11),
			('ses_lib', 'wses_lib', 12), ('ses_unscoped', 'wses_unscoped', 13),
			('ses_copy', 'wses_copy', 14), ('ses_two_a', 'wses_two', 15), ('ses_two_b', 'wses_two', 16);
	`);
	db.close();
	return file;
}

/** The chats kilo.core reads from the Kilo server, stamped as origin stamped them. */
function originChats() {
	return [
		chat("ses_live", { workspaceId: "w-app" }),
		chat("ses_archived", { workspaceId: "w-app", archivedAt: 500 }),
		chat("ses_lib", { workspaceId: "w-lib", directory: "/projects/lib" }),
		chat("ses_unscoped", { workspaceId: null, directory: "/Users/me" }),
		chat("ses_copy", { workspaceId: "w-app", directory: COPY, worktreeBranch: "kilo/brave-fox" }),
		chat("ses_two_a", { workspaceId: "w-app", createdAt: 15 }),
		chat("ses_two_b", { workspaceId: "w-app", createdAt: 16 }),
		// Created in origin after its last link was saved: adopted from its stamp.
		chat("ses_new", { workspaceId: "w-lib", directory: "/projects/lib", archivedAt: 600 }),
	];
}

const EXPECTED = {
	wses_live: { workspaceId: "w-app", archived: false, chatIds: ["ses_live"] },
	wses_archived: { workspaceId: "w-app", archived: true, chatIds: ["ses_archived"] },
	wses_lib: { workspaceId: "w-lib", archived: false, chatIds: ["ses_lib"] },
	wses_unscoped: { workspaceId: null, archived: false, chatIds: ["ses_unscoped"] },
	wses_copy: { workspaceId: "w-app", archived: false, chatIds: ["ses_copy"] },
	wses_two: { workspaceId: "w-app", archived: false, chatIds: ["ses_two_a", "ses_two_b"] },
	adopted: { workspaceId: "w-lib", archived: true, chatIds: ["ses_new"] },
};

async function launch(storage: MemoryStorage, database: string, chatsArriveLate: boolean) {
	const core = new FakeCore();
	core.chats = originChats();
	core.ready = !chatsArriveLate;
	let id = 0;
	const booted = await bootWorkSessions({
		storage,
		core,
		createId: () => `wses_adopted_${++id}`,
		options: {
			workspaces: () => ({ originDatabase: database, folderCheckIntervalMs: 60_000 }),
			workSessions: () => ({ originDatabase: database, createId: () => `wses_adopted_${++id}` }),
		},
	});
	if (chatsArriveLate) {
		await vi.waitFor(() =>
			expect(booted.workspaces.getState().workspaces.map((w) => w.id)).toEqual(["w-app", "w-lib"]),
		);
		core.setReady(true);
	}
	await vi.waitFor(() => expect(booted.list()).toHaveLength(7));
	// The fixture's folders don't exist; let the availability check settle before stopping.
	await vi.waitFor(() =>
		expect(booted.workspaces.getState().unavailableFolderIds).toEqual(["f-app", "f-lib"]),
	);
	return booted;
}

function summary(booted: Awaited<ReturnType<typeof launch>>) {
	return Object.fromEntries(
		booted.list().map((workSession) => [
			workSession.id.startsWith("wses_adopted_") ? "adopted" : workSession.id,
			{
				workspaceId: workSession.workspaceId,
				archived: workSession.archived,
				chatIds: workSession.chatIds,
			},
		]),
	);
}

describe("upgrading from origin on the same profile", () => {
	for (const chatsArriveLate of [false, true]) {
		const when = chatsArriveLate ? "after" : "before";
		it(`keeps workspaces and archives across two launches (chats ready ${when} the import)`, async () => {
			const database = originDatabase();
			const storage = createMemoryStorage(path.join(root, "kilo.work-sessions"));

			const first = await launch(storage, database, chatsArriveLate);
			expect(first.workspaces.getState().workspaces.map((w) => [w.id, w.name])).toEqual([
				["w-app", "App"],
				["w-lib", "Lib"],
			]);
			expect(summary(first)).toEqual(EXPECTED);
			expect(first.byId("wses_copy")).toMatchObject({ branch: "kilo/brave-fox", directory: COPY });
			await first.kernel.stop();

			const second = await launch(storage, database, chatsArriveLate);
			expect(summary(second)).toEqual(EXPECTED);
			await second.kernel.stop();
		});
	}

	it("keeps a migrated session restored once the person unarchives it", async () => {
		const database = originDatabase();
		const storage = createMemoryStorage(path.join(root, "kilo.work-sessions"));

		const first = await launch(storage, database, false);
		await first.workSessions.methods.setArchived({ id: "wses_archived", archived: false });
		await first.kernel.stop();

		const second = await launch(storage, database, false);
		expect(second.byId("wses_archived")).toMatchObject({ archived: false, workspaceId: "w-app" });
		await second.kernel.stop();
	});
});
