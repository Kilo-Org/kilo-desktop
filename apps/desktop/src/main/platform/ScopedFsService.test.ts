import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BusinessError } from "./BusinessError.js";
import { ScopedFsService } from "./ScopedFsService.js";

let storageRoot: string;
let service: ScopedFsService;

beforeEach(() => {
	storageRoot = mkdtempSync(path.join(tmpdir(), "scoped-fs-"));
	service = new ScopedFsService((featureId) => path.join(storageRoot, "plugins", featureId));
});

afterEach(() => {
	rmSync(storageRoot, { recursive: true, force: true });
});

describe("ScopedFsService", () => {
	it("round-trips a file inside the feature sandbox", async () => {
		await service.writeFile("todos", "notes/hello.txt", "Hi!");
		await expect(service.readFile("todos", "notes/hello.txt")).resolves.toBe("Hi!");
		await expect(service.exists("todos", "notes/hello.txt")).resolves.toBe(true);
		await expect(service.readdir("todos", "notes")).resolves.toEqual(["hello.txt"]);
	});

	it("creates directories and removes files and directories recursively", async () => {
		await service.mkdir("todos", "a/b");
		await expect(service.exists("todos", "a/b")).resolves.toBe(true);
		await service.writeFile("todos", "a/b/c.txt", "x");
		await service.remove("todos", "a");
		await expect(service.exists("todos", "a")).resolves.toBe(false);
		// Removing a missing path is a no-op.
		await expect(service.remove("todos", "a")).resolves.toBeUndefined();
	});

	it("scopes each feature to its own sandbox directory", async () => {
		await service.writeFile("todos", "shared-name.txt", "from todos");
		await expect(service.exists("other", "shared-name.txt")).resolves.toBe(false);
		await expect(service.readdir("other", "")).resolves.toEqual([]);
	});

	it("rejects absolute paths", async () => {
		await expect(service.readFile("todos", path.resolve(storageRoot, "x.txt"))).rejects.toThrow(
			BusinessError,
		);
		await expect(service.readFile("todos", "/etc/passwd")).rejects.toThrow(/must be relative/);
	});

	it("rejects paths that escape the sandbox", async () => {
		await service.writeFile("other", "secret.txt", "hidden");
		await expect(service.readFile("todos", "../other/secret.txt")).rejects.toThrow(/cannot escape/);
		await expect(service.writeFile("todos", "a/../../../x.txt", "x")).rejects.toThrow(
			/cannot escape/,
		);
		await expect(service.remove("todos", "..")).rejects.toThrow(/cannot escape/);
	});

	it("rejects feature ids that are not plain kebab-case", async () => {
		await expect(service.readFile("../todos", "x.txt")).rejects.toThrow(/invalid feature id/);
		await expect(service.readFile("UPPER", "x.txt")).rejects.toThrow(/invalid feature id/);
		await expect(service.readFile("", "x.txt")).rejects.toThrow(/invalid feature id/);
	});

	it("translates expected fs failures to BusinessError without host paths", async () => {
		const error = await service.readFile("todos", "missing.txt").catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(BusinessError);
		expect((error as Error).message).toContain('"missing.txt"');
		expect((error as Error).message).not.toContain(storageRoot);

		await service.mkdir("todos", "a-dir");
		await expect(service.readFile("todos", "a-dir")).rejects.toThrow(/is a directory/);
		await service.writeFile("todos", "a-file.txt", "x");
		await expect(service.readdir("todos", "a-file.txt")).rejects.toThrow(BusinessError);
	});

	it("treats the sandbox root itself as a valid readable directory", async () => {
		await expect(service.readdir("fresh-feature", "")).resolves.toEqual([]);
		await expect(service.exists("fresh-feature", "")).resolves.toBe(true);
	});
});
