import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ImportStagingRegistry, readFileNoFollow } from "./importStaging";

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "import-staging-test-"));
	createdRoots.push(root);
	return root;
}

afterEach(async () => {
	for (const dir of createdRoots.splice(0)) {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
});

describe("readFileNoFollow", () => {
	it("reads a regular file", async () => {
		const root = await makeRoot();
		const file = join(root, "env.yml");
		await writeFile(file, "name: x\n", "utf-8");
		expect((await readFileNoFollow(file, 1024)).toString("utf-8")).toBe("name: x\n");
	});

	it("rejects a file over the byte cap", async () => {
		const root = await makeRoot();
		const file = join(root, "env.yml");
		await writeFile(file, "a".repeat(2048), "utf-8");
		await expect(readFileNoFollow(file, 1024)).rejects.toThrow(/too large/i);
	});

	it.skipIf(!fsConstants.O_NOFOLLOW)("refuses to follow a symlink", async () => {
		const root = await makeRoot();
		const target = join(root, "target.yml");
		await writeFile(target, "name: x\n", "utf-8");
		const link = join(root, "link.yml");
		await symlink(target, link);
		await expect(readFileNoFollow(link, 1024)).rejects.toThrow();
	});
});

describe("ImportStagingRegistry", () => {
	it("stages content under a YAML-named file and resolves it back", async () => {
		const root = await makeRoot();
		const registry = new ImportStagingRegistry({ rootDir: root });
		const entry = await registry.stage("name: staged\n");

		expect(entry.stagedPath.endsWith("env.yml")).toBe(true);
		expect(await readFile(entry.stagedPath, "utf-8")).toBe("name: staged\n");
		await expect(registry.resolve(entry.handle)).resolves.toMatchObject({ handle: entry.handle });
	});

	it("rejects an unknown handle with VALIDATION", async () => {
		const root = await makeRoot();
		const registry = new ImportStagingRegistry({ rootDir: root });
		await expect(registry.resolve("123e4567-e89b-12d3-a456-426614174000")).rejects.toThrow(
			/staged file not found/i,
		);
	});

	it("expires staged copies past the TTL", async () => {
		const root = await makeRoot();
		let now = 1_000;
		const registry = new ImportStagingRegistry({ rootDir: root, ttlMs: 100, now: () => now });
		const entry = await registry.stage("name: x\n");

		now = 1_050;
		await registry.sweep();
		await expect(readFile(entry.stagedPath, "utf-8")).resolves.toBe("name: x\n");

		now = 1_101;
		await registry.sweep();
		await expect(registry.resolve(entry.handle)).rejects.toThrow(/staged file not found/i);
	});

	it("detects a tampered staged copy via its digest and drops it", async () => {
		const root = await makeRoot();
		const registry = new ImportStagingRegistry({ rootDir: root });
		const entry = await registry.stage("name: x\n");
		await writeFile(entry.stagedPath, "name: evil\n", "utf-8");

		await expect(registry.resolve(entry.handle)).rejects.toThrow(/integrity/i);
		// The corrupted entry and its directory are gone, not left until the TTL.
		await expect(readFile(entry.stagedPath, "utf-8")).rejects.toThrow();
		await expect(registry.resolve(entry.handle)).rejects.toThrow(/staged file not found/i);
	});

	it("drops the entry and directory when the staged file is missing", async () => {
		const root = await makeRoot();
		const registry = new ImportStagingRegistry({ rootDir: root });
		const entry = await registry.stage("name: x\n");
		await rm(entry.stagedPath);

		await expect(registry.resolve(entry.handle)).rejects.toThrow(/staged file not found/i);
		await expect(access(join(root, "import-staging", entry.handle))).rejects.toThrow();
	});

	it("evicts the oldest staged copy past the entry cap", async () => {
		const root = await makeRoot();
		const registry = new ImportStagingRegistry({ rootDir: root, maxEntries: 2 });
		const first = await registry.stage("name: a\n");
		await registry.stage("name: b\n");
		await registry.stage("name: c\n");

		await expect(registry.resolve(first.handle)).rejects.toThrow(/staged file not found/i);
		await expect(readFile(first.stagedPath, "utf-8")).rejects.toThrow();
	});

	it("releases a staged copy and its directory", async () => {
		const root = await makeRoot();
		const registry = new ImportStagingRegistry({ rootDir: root });
		const entry = await registry.stage("name: x\n");

		await registry.release(entry.handle);
		await expect(readFile(entry.stagedPath, "utf-8")).rejects.toThrow();
	});

	it("dispose removes the whole staging directory", async () => {
		const root = await makeRoot();
		const registry = new ImportStagingRegistry({ rootDir: root });
		await registry.stage("name: x\n");

		await registry.dispose();
		await expect(access(join(root, "import-staging"))).rejects.toThrow();
	});

	it("pins a resolved handle so a sweep past the TTL keeps its staged copy", async () => {
		const root = await makeRoot();
		let now = 1_000;
		const registry = new ImportStagingRegistry({ rootDir: root, ttlMs: 100, now: () => now });
		const entry = await registry.stage("name: pinned\n");
		await registry.resolve(entry.handle);

		now = 5_000;
		await registry.sweep();

		expect(await readFile(entry.stagedPath, "utf-8")).toBe("name: pinned\n");

		await registry.release(entry.handle);
		await expect(readFile(entry.stagedPath, "utf-8")).rejects.toThrow();
	});

	it("rejects a second resolve of a handle already in flight", async () => {
		const root = await makeRoot();
		const registry = new ImportStagingRegistry({ rootDir: root });
		const entry = await registry.stage("name: x\n");
		await registry.resolve(entry.handle);

		await expect(registry.resolve(entry.handle)).rejects.toThrow(/already being imported/i);
		expect(await readFile(entry.stagedPath, "utf-8")).toBe("name: x\n");

		await registry.release(entry.handle);
		await expect(registry.resolve(entry.handle)).rejects.toThrow(/staged file not found/i);
	});

	it("rejects a concurrent second resolve of the same handle", async () => {
		const root = await makeRoot();
		const registry = new ImportStagingRegistry({ rootDir: root });
		const entry = await registry.stage("name: x\n");

		const results = await Promise.allSettled([
			registry.resolve(entry.handle),
			registry.resolve(entry.handle),
		]);

		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
	});

	it("does not evict a pinned handle past the entry cap", async () => {
		const root = await makeRoot();
		const registry = new ImportStagingRegistry({ rootDir: root, maxEntries: 1 });
		const pinned = await registry.stage("name: pinned\n");
		await registry.resolve(pinned.handle);

		const other = await registry.stage("name: other\n");

		// The pinned copy survives the cap and is still on disk.
		expect(await readFile(pinned.stagedPath, "utf-8")).toBe("name: pinned\n");
		await expect(registry.resolve(other.handle)).resolves.toBeTruthy();
	});
});
