import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFeatureKvStoreFactory } from "./featureKvStore.js";

/**
 * End-to-end coverage of the `electron-store`-backed KV factory: verifies
 * that the shell's `mainSdk.storage.kv(...)` wiring actually reads and
 * writes a JSON file in the feature's storage directory, with atomic
 * writes, defaults for missing keys, and corrupt-file recovery.
 */
describe("createFeatureKvStoreFactory", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = path.join(
			os.tmpdir(),
			`feature-kv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("writes to <storageDir>/<namespace>.json", async () => {
		const factory = createFeatureKvStoreFactory(tempDir);
		const kv = factory({ namespace: "settings", defaults: { enabled: true } });
		kv.set({ enabled: false });

		const raw = await readFile(path.join(tempDir, "settings.json"), "utf-8");
		expect(JSON.parse(raw)).toEqual({ enabled: false });
	});

	it("defaults namespace to 'kv' when omitted", () => {
		const factory = createFeatureKvStoreFactory(tempDir);
		const kv = factory({ defaults: { count: 0 } });
		kv.set({ count: 3 });
		expect(kv.snapshot()).toEqual({ count: 3 });
	});

	it("snapshot backfills defaults for missing persisted keys", async () => {
		await writeFile(
			path.join(tempDir, "settings.json"),
			JSON.stringify({ enabled: false }),
			"utf-8",
		);
		const factory = createFeatureKvStoreFactory(tempDir);
		const kv = factory({
			namespace: "settings",
			defaults: { enabled: true, urlOverride: null as string | null },
		});
		expect(kv.snapshot()).toEqual({ enabled: false, urlOverride: null });
	});

	it("get reads one key without materialising the whole snapshot", () => {
		const factory = createFeatureKvStoreFactory(tempDir);
		const kv = factory({ defaults: { a: 1, b: 2 } });
		expect(kv.get("a")).toBe(1);
		kv.set({ b: 99 });
		expect(kv.get("b")).toBe(99);
	});

	it("set ignores keys whose value is undefined", () => {
		const factory = createFeatureKvStoreFactory(tempDir);
		type Settings = { enabled: boolean; urlOverride: string | null };
		const kv = factory<Settings>({ defaults: { enabled: true, urlOverride: "https://a" } });
		kv.set({ enabled: false });
		// Explicit-undefined patch must preserve the existing value. Cast is
		// necessary under `exactOptionalPropertyTypes`: the intent of the
		// test is to prove the runtime strips undefined even if a caller
		// bypasses the compile-time check (e.g. by widening the patch shape).
		kv.set({ enabled: undefined, urlOverride: "https://b" } as unknown as Partial<Settings>);
		expect(kv.snapshot()).toEqual({ enabled: false, urlOverride: "https://b" });
	});

	// Regression: honour the "explicit null = no override" idiom. `??` would
	// coalesce `null` away; we spread instead so `null` survives.
	it("set persists explicit null values", () => {
		const factory = createFeatureKvStoreFactory(tempDir);
		const kv = factory({
			namespace: "settings",
			defaults: { urlOverride: "https://default" as string | null },
		});
		kv.set({ urlOverride: null });
		expect(kv.snapshot()).toEqual({ urlOverride: null });
	});

	it("recovers to defaults on malformed JSON without crashing", async () => {
		await writeFile(path.join(tempDir, "settings.json"), "not json", "utf-8");
		const factory = createFeatureKvStoreFactory(tempDir);
		const kv = factory({ namespace: "settings", defaults: { enabled: true } });
		expect(kv.snapshot()).toEqual({ enabled: true });
	});

	it("clear resets to defaults", () => {
		const factory = createFeatureKvStoreFactory(tempDir);
		const kv = factory({ defaults: { count: 0 } });
		kv.set({ count: 42 });
		kv.clear();
		expect(kv.snapshot()).toEqual({ count: 0 });
	});

	// `set` returns the new snapshot; callers use it to update UI state
	// without a second read.
	it("set returns the merged snapshot", () => {
		const factory = createFeatureKvStoreFactory(tempDir);
		const kv = factory({ defaults: { a: 1, b: 2 } });
		expect(kv.set({ a: 10 })).toEqual({ a: 10, b: 2 });
	});

	// Security: the namespace becomes the file name inside the feature's
	// storage dir, and electron-store's `path.resolve(cwd, name + ".json")`
	// normalises `..`. Without validation, `"../shared"` would land the
	// backing file outside the sandbox — violating the invariant
	// `mainSdk.storage.kv` promises callers.
	it.each([
		["namespace escaping the sandbox with .. segment", "../shared"],
		["namespace containing a forward slash", "foo/bar"],
		["namespace containing a backslash", "foo\\bar"],
		["empty namespace", ""],
	])("rejects %s", (_label, namespace) => {
		const factory = createFeatureKvStoreFactory(tempDir);
		expect(() => factory({ namespace, defaults: { a: 1 } })).toThrow(/Invalid KV namespace/);
	});
});
