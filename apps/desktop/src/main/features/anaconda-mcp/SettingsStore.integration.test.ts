import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsStore } from "./SettingsStore.js";

describe("SettingsStore", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = path.join(
			os.tmpdir(),
			`anaconda-mcp-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("returns defaults when no persisted file exists", () => {
		const store = new SettingsStore(tempDir);
		expect(store.get()).toEqual({ enabled: true, urlOverride: null });
	});

	it("loads persisted settings from disk", async () => {
		await writeFile(
			path.join(tempDir, "settings.json"),
			JSON.stringify({ enabled: false, urlOverride: "https://custom.example.com" }),
			"utf-8",
		);
		const store = new SettingsStore(tempDir);
		expect(store.get()).toEqual({ enabled: false, urlOverride: "https://custom.example.com" });
	});

	it("persists enabled=false so a user's disable choice survives restarts", () => {
		const store = new SettingsStore(tempDir);
		store.set({ enabled: false });

		// Simulate a restart by re-loading.
		const restarted = new SettingsStore(tempDir);
		expect(restarted.get().enabled).toBe(false);
	});

	it("persists urlOverride: null explicitly (does not fall back to previous)", async () => {
		await writeFile(
			path.join(tempDir, "settings.json"),
			JSON.stringify({ enabled: true, urlOverride: "https://custom.example.com" }),
			"utf-8",
		);
		const store = new SettingsStore(tempDir);
		store.set({ urlOverride: null });

		expect(store.get().urlOverride).toBeNull();
		const restarted = new SettingsStore(tempDir);
		expect(restarted.get().urlOverride).toBeNull();
	});

	it("falls back to defaults on malformed JSON without crashing", async () => {
		await writeFile(path.join(tempDir, "settings.json"), "this is not json", "utf-8");
		const store = new SettingsStore(tempDir);
		expect(store.get()).toEqual({ enabled: true, urlOverride: null });
	});

	it("normalizes wrong-typed persisted values back to defaults", async () => {
		await writeFile(
			path.join(tempDir, "settings.json"),
			JSON.stringify({ enabled: "yes", urlOverride: 42 }),
			"utf-8",
		);
		const store = new SettingsStore(tempDir);
		expect(store.get()).toEqual({ enabled: true, urlOverride: null });
	});

	it("writes are immediately visible on disk (synchronous, atomic)", async () => {
		const store = new SettingsStore(tempDir);
		store.set({ enabled: false });
		store.set({ urlOverride: "https://c.example.com" });

		const raw = await readFile(path.join(tempDir, "settings.json"), "utf-8");
		expect(JSON.parse(raw)).toEqual({ enabled: false, urlOverride: "https://c.example.com" });
	});

	// Regression: PR #116 review — WARNING SettingsStore.ts. Persistence
	// failures must not be swallowed: `set()` throws (electron-store's
	// synchronous write), so a contract handler / UI learns the change was
	// NOT saved instead of it silently reverting on the next restart.
	it("set() throws when the on-disk write fails, and recovers once fixed", async () => {
		const store = new SettingsStore(tempDir);
		store.set({ enabled: false });

		// Make the backing file's parent unusable: replace the settings file
		// with a directory so the atomic rename fails.
		const file = path.join(tempDir, "settings.json");
		await rm(file);
		await mkdir(file);

		expect(() => store.set({ urlOverride: "https://x.test" })).toThrow();

		// Fix the filesystem, then retry — the store is not poisoned. (The
		// simulated failure deleted the backing file, so previously persisted
		// values are gone and `enabled` reads its default again.)
		await rm(file, { recursive: true });
		expect(store.set({ urlOverride: "https://x.test" })).toEqual({
			enabled: true,
			urlOverride: "https://x.test",
		});
	});
});
