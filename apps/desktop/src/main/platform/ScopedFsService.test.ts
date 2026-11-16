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
		await service.writeFile("kilo.todos", "notes/hello.txt", "Hi!");
		await expect(service.readFile("kilo.todos", "notes/hello.txt")).resolves.toBe("Hi!");
		await expect(service.exists("kilo.todos", "notes/hello.txt")).resolves.toBe(true);
		await expect(service.readdir("kilo.todos", "notes")).resolves.toEqual(["hello.txt"]);
	});

	it("creates directories and removes files and directories recursively", async () => {
		await service.mkdir("kilo.todos", "a/b");
		await expect(service.exists("kilo.todos", "a/b")).resolves.toBe(true);
		await service.writeFile("kilo.todos", "a/b/c.txt", "x");
		await service.remove("kilo.todos", "a");
		await expect(service.exists("kilo.todos", "a")).resolves.toBe(false);
		// Removing a missing path is a no-op.
		await expect(service.remove("kilo.todos", "a")).resolves.toBeUndefined();
	});

	it("scopes each feature to its own sandbox directory", async () => {
		await service.writeFile("kilo.todos", "shared-name.txt", "from todos");
		await expect(service.exists("kilo.other", "shared-name.txt")).resolves.toBe(false);
		await expect(service.readdir("kilo.other", "")).resolves.toEqual([]);
	});

	it("rejects absolute paths", async () => {
		await expect(
			service.readFile("kilo.todos", path.resolve(storageRoot, "x.txt")),
		).rejects.toThrow(BusinessError);
		await expect(service.readFile("kilo.todos", "/etc/passwd")).rejects.toThrow(/must be relative/);
	});

	it("rejects paths that escape the sandbox", async () => {
		await service.writeFile("kilo.other", "secret.txt", "hidden");
		await expect(service.readFile("kilo.todos", "../other/secret.txt")).rejects.toThrow(
			/cannot escape/,
		);
		await expect(service.writeFile("kilo.todos", "a/../../../x.txt", "x")).rejects.toThrow(
			/cannot escape/,
		);
		await expect(service.remove("kilo.todos", "..")).rejects.toThrow(/cannot escape/);
	});

	it("rejects values that are not plugin ids", async () => {
		await expect(service.readFile("../kilo.todos", "x.txt")).rejects.toThrow(/invalid plugin id/);
		await expect(service.readFile("UPPER", "x.txt")).rejects.toThrow(/invalid plugin id/);
		await expect(service.readFile("", "x.txt")).rejects.toThrow(/invalid plugin id/);
	});

	it("translates expected fs failures to BusinessError without host paths", async () => {
		const error = await service
			.readFile("kilo.todos", "missing.txt")
			.catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(BusinessError);
		expect((error as Error).message).toContain('"missing.txt"');
		expect((error as Error).message).not.toContain(storageRoot);

		await service.mkdir("kilo.todos", "a-dir");
		await expect(service.readFile("kilo.todos", "a-dir")).rejects.toThrow(/is a directory/);
		await service.writeFile("kilo.todos", "a-file.txt", "x");
		await expect(service.readdir("kilo.todos", "a-file.txt")).rejects.toThrow(BusinessError);
	});

	it("translates write-path failures to BusinessError", async () => {
		await service.mkdir("kilo.todos", "adir");
		// Writing onto an existing directory → EISDIR.
		await expect(service.writeFile("kilo.todos", "adir", "x")).rejects.toThrow(/is a directory/);
		await service.writeFile("kilo.todos", "afile.txt", "x");
		// A path segment under an existing file is a translated BusinessError
		// (EEXIST or ENOTDIR depending on platform), never a scrubbed INTERNAL.
		const writeError = await service
			.writeFile("kilo.todos", "afile.txt/child.txt", "y")
			.catch((cause: unknown) => cause);
		expect(writeError).toBeInstanceOf(BusinessError);
		expect((writeError as Error).message).toMatch(/is not a directory|already exists/);
		const mkdirError = await service
			.mkdir("kilo.todos", "afile.txt/child")
			.catch((cause: unknown) => cause);
		expect(mkdirError).toBeInstanceOf(BusinessError);
		expect((mkdirError as Error).message).toMatch(/is not a directory|already exists/);
	});

	it("exists returns false for a path under an existing file (ENOTDIR)", async () => {
		await service.writeFile("kilo.todos", "file.txt", "x");
		await expect(service.exists("kilo.todos", "file.txt/nope")).resolves.toBe(false);
	});

	it("treats the sandbox root itself as a valid readable directory", async () => {
		await expect(service.readdir("kilo.fresh", "")).resolves.toEqual([]);
		await expect(service.exists("kilo.fresh", "")).resolves.toBe(true);
	});
});
