import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	checkDataFolder,
	DATA_VERSION_FILE,
	refuseNewerData,
	upgradeDataFolder,
	type DataMigration,
} from "./dataVersion.js";

let userData: string;
beforeEach(() => {
	userData = mkdtempSync(path.join(tmpdir(), "kilo-data-version-"));
});
afterEach(() => {
	rmSync(userData, { recursive: true, force: true });
});

const record = (value: unknown) =>
	writeFileSync(path.join(userData, DATA_VERSION_FILE), JSON.stringify(value));
const recorded = () =>
	JSON.parse(readFileSync(path.join(userData, DATA_VERSION_FILE), "utf8")) as unknown;

describe("checkDataFolder", () => {
	it("opens a folder at this build's data version or below", () => {
		expect(checkDataFolder(userData, 1)).toEqual({ kind: "ready" });
		record({ dataVersion: 1, writtenBy: "1.0.0" });
		expect(checkDataFolder(userData, 2)).toEqual({ kind: "ready" });
		expect(checkDataFolder(userData, 1)).toEqual({ kind: "ready" });
	});

	it("refuses a folder a build with a higher data version wrote, naming that build", () => {
		record({ dataVersion: 3, writtenBy: "1.4.0" });

		expect(checkDataFolder(userData, 2)).toEqual({
			kind: "newer",
			dataVersion: 3,
			writtenBy: "1.4.0",
		});
	});

	it("treats a record it cannot make sense of as the first data version", () => {
		writeFileSync(path.join(userData, DATA_VERSION_FILE), "{ not json");
		expect(checkDataFolder(userData, 1)).toEqual({ kind: "ready" });
		record({ dataVersion: "two" });
		expect(checkDataFolder(userData, 1)).toEqual({ kind: "ready" });
	});
});

describe("upgradeDataFolder", () => {
	const now = () => new Date("2026-11-27T10:00:00Z");

	it("records this build's data version and app version", () => {
		upgradeDataFolder(userData, { appVersion: "1.2.0", buildVersion: 1, migrations: [], now });

		expect(recorded()).toEqual({ dataVersion: 1, writtenBy: "1.2.0" });
	});

	it("backs up the files a migration changes, then runs the migrations it hasn't run yet", () => {
		mkdirSync(path.join(userData, "plugins", "acme"), { recursive: true });
		writeFileSync(path.join(userData, "plugins", "acme", "store.json"), '{"old":true}');
		record({ dataVersion: 1, writtenBy: "1.0.0" });
		const ran: number[] = [];
		const migration = (to: number): DataMigration => ({
			to,
			files: ["plugins/acme/store.json", "missing.json"],
			migrate: (dir) => {
				ran.push(to);
				writeFileSync(path.join(dir, "plugins", "acme", "store.json"), `{"to":${to}}`);
			},
		});

		upgradeDataFolder(userData, {
			appVersion: "1.5.0",
			buildVersion: 3,
			migrations: [migration(3), migration(2), migration(1)],
			now,
		});

		expect(ran).toEqual([2, 3]);
		expect(recorded()).toEqual({ dataVersion: 3, writtenBy: "1.5.0" });
		const backups = path.join(userData, "backups");
		expect(readdirSync(backups).sort()).toEqual([
			"data-version-2-2026-11-27T10-00-00Z",
			"data-version-3-2026-11-27T10-00-00Z",
		]);
		expect(
			readFileSync(
				path.join(backups, "data-version-2-2026-11-27T10-00-00Z", "plugins/acme/store.json"),
				"utf8",
			),
		).toBe('{"old":true}');
		expect(
			readFileSync(
				path.join(backups, "data-version-3-2026-11-27T10-00-00Z", "plugins/acme/store.json"),
				"utf8",
			),
		).toBe('{"to":2}');
	});

	it("keeps the progress of migrations that finished when a later one fails", () => {
		record({ dataVersion: 1, writtenBy: "1.0.0" });
		const failing: DataMigration = {
			to: 3,
			files: [],
			migrate: () => {
				throw new Error("disk full");
			},
		};

		expect(() =>
			upgradeDataFolder(userData, {
				appVersion: "1.5.0",
				buildVersion: 3,
				migrations: [{ to: 2, files: [], migrate: () => {} }, failing],
				now,
			}),
		).toThrow("disk full");
		expect(recorded()).toEqual({ dataVersion: 2, writtenBy: "1.5.0" });
	});
});

describe("refuseNewerData", () => {
	const deps = (response: number) => ({
		whenReady: vi.fn(async () => {}),
		showMessageBox: vi.fn(async () => ({ response })),
		openExternal: vi.fn(async () => true),
		quit: vi.fn(),
	});

	it("explains which build wrote the data and offers the download before quitting", async () => {
		const ui = deps(0);

		await refuseNewerData({ kind: "newer", dataVersion: 3, writtenBy: "1.4.0" }, ui);

		expect(ui.showMessageBox).toHaveBeenCalledWith(
			expect.objectContaining({
				detail: expect.stringContaining("a newer version of Kilo (1.4.0)"),
				buttons: ["Download latest", "Quit"],
			}),
		);
		expect(ui.openExternal).toHaveBeenCalledWith("https://kilo.ai/install");
		expect(ui.quit).toHaveBeenCalledOnce();
	});

	it("quits without opening anything when the person chooses Quit", async () => {
		const ui = deps(1);

		await refuseNewerData({ kind: "newer", dataVersion: 3, writtenBy: null }, ui);

		expect(ui.openExternal).not.toHaveBeenCalled();
		expect(ui.quit).toHaveBeenCalledOnce();
	});
});
