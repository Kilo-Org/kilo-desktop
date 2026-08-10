import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsStore } from "./SettingsStore.js";

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const DEFAULTS = { enabled: true, urlOverride: null } as const;

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

	it("returns defaults when no persisted file exists", async () => {
		const store = await SettingsStore.load(tempDir, { ...DEFAULTS }, silentLogger);
		expect(store.get()).toEqual({ enabled: true, urlOverride: null });
	});

	it("loads persisted settings from disk", async () => {
		await writeFile(
			path.join(tempDir, "settings.json"),
			JSON.stringify({ enabled: false, urlOverride: "https://custom.example.com" }),
			"utf-8",
		);
		const store = await SettingsStore.load(tempDir, { ...DEFAULTS }, silentLogger);
		expect(store.get()).toEqual({ enabled: false, urlOverride: "https://custom.example.com" });
	});

	it("persists enabled=false so a user's disable choice survives restarts", async () => {
		const store = await SettingsStore.load(tempDir, { ...DEFAULTS }, silentLogger);
		await store.set({ enabled: false });

		// Simulate a restart by re-loading.
		const restarted = await SettingsStore.load(tempDir, { ...DEFAULTS }, silentLogger);
		expect(restarted.get().enabled).toBe(false);
	});

	it("persists urlOverride: null explicitly (does not fall back to previous)", async () => {
		await writeFile(
			path.join(tempDir, "settings.json"),
			JSON.stringify({ enabled: true, urlOverride: "https://custom.example.com" }),
			"utf-8",
		);
		const store = await SettingsStore.load(tempDir, { ...DEFAULTS }, silentLogger);
		await store.set({ urlOverride: null });

		expect(store.get().urlOverride).toBeNull();
		const restarted = await SettingsStore.load(tempDir, { ...DEFAULTS }, silentLogger);
		expect(restarted.get().urlOverride).toBeNull();
	});

	it("falls back to defaults on malformed JSON without crashing", async () => {
		await writeFile(path.join(tempDir, "settings.json"), "this is not json", "utf-8");
		const store = await SettingsStore.load(tempDir, { ...DEFAULTS }, silentLogger);
		expect(store.get()).toEqual(DEFAULTS);
	});

	it("coalesces rapid writes so the latest state wins", async () => {
		const store = await SettingsStore.load(tempDir, { ...DEFAULTS }, silentLogger);
		// Fire multiple updates without awaiting individual promises.
		void store.set({ enabled: false });
		void store.set({ urlOverride: "https://a.example.com" });
		void store.set({ urlOverride: "https://b.example.com" });
		await store.set({ urlOverride: "https://c.example.com" });

		// Give the coalesced write a chance to complete.
		await new Promise((resolve) => setTimeout(resolve, 10));

		const raw = await readFile(path.join(tempDir, "settings.json"), "utf-8");
		const parsed = JSON.parse(raw);
		expect(parsed).toEqual({ enabled: false, urlOverride: "https://c.example.com" });
	});

	// Regression: PR #116 review — WARNING SettingsStore.ts:100. The old
	// `set()` swallowed persistence failures and always resolved, so a
	// contract handler / UI would report success even when nothing hit disk.
	// Now `set()` rejects on failure so the caller can surface the error.
	it("rejects set() when the on-disk write fails", async () => {
		// Point the store at a path that becomes unwritable (parent is a file).
		const parent = path.join(tempDir, "settings-parent");
		await writeFile(parent, "not a directory", "utf-8");
		const doomedDir = path.join(parent, "settings-child");
		// The store persists to `<storageDir>/settings.json`, so pointing
		// storageDir into `parent/settings-child/` fails at mkdir/writeFile
		// because `parent` is a regular file.
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const store = await SettingsStore.load(doomedDir, { ...DEFAULTS }, logger);
		await expect(store.set({ enabled: false })).rejects.toThrow();
		// The warning path still fires so operators see the failure.
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("failed to persist"));
	});

	it("a later successful set() runs even after a prior set() rejected", async () => {
		// The chain must not be poisoned by a failed write.
		const parent = path.join(tempDir, "poisoned-parent");
		await writeFile(parent, "not a directory", "utf-8");
		const doomedDir = path.join(parent, "child");
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const store = await SettingsStore.load(doomedDir, { ...DEFAULTS }, logger);
		await expect(store.set({ enabled: false })).rejects.toThrow();

		// Fix the filesystem (remove the file, create the dir), then retry.
		await rm(parent);
		await mkdir(doomedDir, { recursive: true });
		await expect(store.set({ enabled: false })).resolves.toEqual({
			enabled: false,
			urlOverride: null,
		});
	});
});
