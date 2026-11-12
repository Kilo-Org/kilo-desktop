import fs from "node:fs";
import { mkdtemp, mkdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { KernelError } from "@kilo-desktop/kernel";

import { FilesService } from "./files-service";

/**
 * Table-read seam: optionally caps every `FileHandle.read` (short reads are
 * legal) and runs a hook before the first read (e.g. growing the file after
 * the service's `stat`). Delegates to the real filesystem otherwise.
 */
const tableReads = vi.hoisted(() => ({
	maxChunk: undefined as number | undefined,
	beforeFirstRead: undefined as (() => Promise<void>) | undefined,
	allocations: [] as number[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof FsPromises>();
	return {
		...actual,
		open: async (...args: Parameters<typeof actual.open>) => {
			const handle = await actual.open(...args);
			let first = true;
			const read = handle.read.bind(handle) as (
				buffer: Buffer,
				offset: number,
				length: number,
				position: number,
			) => Promise<{ bytesRead: number; buffer: Buffer }>;
			return Object.assign(handle, {
				read: async (buffer: Buffer, offset: number, length: number, position: number) => {
					if (first) {
						first = false;
						tableReads.allocations.push(buffer.byteLength);
						await tableReads.beforeFirstRead?.();
					}
					const chunk =
						tableReads.maxChunk === undefined ? length : Math.min(length, tableReads.maxChunk);
					return read(buffer, offset, chunk, position);
				},
			});
		},
	};
});

const temporaryDirectories: string[] = [];

/**
 * Filesystem whose directory reads fail with the `EPERM … scandir` error a
 * Windows scan sees when a directory is locked or removed mid-walk. Injecting
 * it exercises the scan's error handling on every platform, without relying on
 * POSIX permission bits.
 */
function fakeFileSystem(fail: (directory: string) => boolean): typeof fs {
	const eperm = (directory: string): NodeJS.ErrnoException =>
		Object.assign(new Error(`EPERM: operation not permitted, scandir '${directory}'`), {
			code: "EPERM",
			syscall: "scandir",
			path: directory,
		});

	return {
		...fs,
		readdir: ((
			directory: fs.PathLike,
			options: unknown,
			callback: (error: NodeJS.ErrnoException | null, entries?: unknown) => void,
		) => {
			const target = String(directory);
			if (fail(target)) {
				process.nextTick(callback, eperm(target));
				return;
			}
			return (fs.readdir as (...args: unknown[]) => unknown)(directory, options, callback);
		}) as typeof fs.readdir,
		promises: {
			...fs.promises,
			opendir: (async (directory: fs.PathLike) => {
				const target = String(directory);
				if (fail(target)) throw eperm(target);
				return fs.promises.opendir(directory);
			}) as typeof fs.promises.opendir,
		},
	};
}

async function temporaryWorkspace(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "files-plugin-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(() => {
	tableReads.maxChunk = undefined;
	tableReads.beforeFirstRead = undefined;
	tableReads.allocations.length = 0;
});

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map(async (directory) => {
			await import("node:fs/promises").then(({ rm }) => rm(directory, { recursive: true }));
		}),
	);
});

describe("FilesService", () => {
	it("lists POSIX paths including gitignored entries and hidden entries", async () => {
		const workspace = await temporaryWorkspace();
		await mkdir(path.join(workspace, "src", "generated"), { recursive: true });
		await writeFile(path.join(workspace, ".hidden"), "visible");
		await writeFile(path.join(workspace, ".env"), "SECRET=hunter2");
		await writeFile(path.join(workspace, ".gitignore"), ".env\nroot-ignored.txt\n");
		await writeFile(path.join(workspace, "root-ignored.txt"), "ignored");
		await writeFile(path.join(workspace, "src", ".gitignore"), "generated/\n");
		await writeFile(path.join(workspace, "src", "index.ts"), "export {};");
		await writeFile(path.join(workspace, "src", "generated", "code.ts"), "ignored");

		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
		});
		await expect(service.list(workspace)).resolves.toEqual({
			paths: [
				".env",
				".gitignore",
				".hidden",
				"root-ignored.txt",
				"src/",
				"src/.gitignore",
				"src/generated/",
				"src/generated/code.ts",
				"src/index.ts",
			],
			truncated: false,
		});
	});

	it("lists only files for mentions, skipping gitignored, .git and worktree paths", async () => {
		const workspace = await temporaryWorkspace();
		await mkdir(path.join(workspace, "src", "generated"), { recursive: true });
		await mkdir(path.join(workspace, "node_modules", "dep"), { recursive: true });
		await mkdir(path.join(workspace, ".git"), { recursive: true });
		await mkdir(path.join(workspace, ".kilo", "worktrees", "kilo-x"), { recursive: true });
		await writeFile(path.join(workspace, ".gitignore"), ".env\nnode_modules/\n");
		await writeFile(path.join(workspace, ".env"), "SECRET=hunter2");
		await writeFile(path.join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n");
		await writeFile(path.join(workspace, ".kilo", "worktrees", "kilo-x", "README.md"), "readme");
		await writeFile(path.join(workspace, "node_modules", "dep", "index.js"), "ignored");
		await writeFile(path.join(workspace, "src", ".gitignore"), "generated/\n");
		await writeFile(path.join(workspace, "src", "generated", "code.ts"), "ignored");
		await writeFile(path.join(workspace, "src", "index.ts"), "export {};");

		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
		});
		await expect(service.listFiles(workspace)).resolves.toEqual({
			paths: [".gitignore", "src/.gitignore", "src/index.ts"],
			truncated: false,
		});
	});

	it("excludes the root .git directory but not nested worktree .git pointer files or other dot files", async () => {
		const workspace = await temporaryWorkspace();
		await mkdir(path.join(workspace, ".git", "objects"), { recursive: true });
		await writeFile(path.join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n");
		const worktreeDirectory = path.join(workspace, ".kilo", "worktrees", "kilo-x");
		await mkdir(worktreeDirectory, { recursive: true });
		await writeFile(path.join(worktreeDirectory, ".git"), "gitdir: /repo/.git/worktrees/kilo-x\n");
		await writeFile(path.join(worktreeDirectory, ".DS_Store"), "junk");
		await writeFile(path.join(worktreeDirectory, "README.md"), "readme");
		await writeFile(path.join(workspace, "Thumbs.db"), "junk");

		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
		});
		await expect(service.list(workspace)).resolves.toEqual({
			paths: [
				".kilo/",
				".kilo/worktrees/",
				".kilo/worktrees/kilo-x/",
				".kilo/worktrees/kilo-x/.DS_Store",
				".kilo/worktrees/kilo-x/.git",
				".kilo/worktrees/kilo-x/README.md",
				"Thumbs.db",
			],
			truncated: false,
		});
	});

	it("caps scans and reports truncation", async () => {
		const workspace = await temporaryWorkspace();
		await Promise.all(
			Array.from({ length: 4 }, (_, index) =>
				writeFile(path.join(workspace, `file-${String(index)}.txt`), "text"),
			),
		);
		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
			scanLimit: 3,
		});

		const result = await service.list(workspace);
		expect(result.paths).toHaveLength(3);
		expect(result.truncated).toBe(true);
	});

	it("skips an unreadable subdirectory and still lists the rest of the workspace", async () => {
		const workspace = await temporaryWorkspace();
		await writeFile(path.join(workspace, "ok.txt"), "ok");
		await mkdir(path.join(workspace, "locked"));
		await writeFile(path.join(workspace, "locked", "secret.txt"), "secret");
		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
			// A directory removed or locked mid-walk fails as an EPERM scandir.
			fileSystem: fakeFileSystem((directory) => path.basename(directory) === "locked"),
		});

		await expect(service.list(workspace)).resolves.toEqual({
			paths: ["locked/", "ok.txt"],
			truncated: false,
		});
	});

	it("still rejects when the workspace root itself is unreadable", async () => {
		const workspace = await temporaryWorkspace();
		await writeFile(path.join(workspace, "a.txt"), "a");
		const root = await realpath(workspace);
		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
			fileSystem: fakeFileSystem((directory) => directory === root),
		});

		await expect(service.list(workspace)).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("finds existing files in one authorized batch without scanning the workspace", async () => {
		const workspace = await temporaryWorkspace();
		const outside = await temporaryWorkspace();
		await mkdir(path.join(workspace, "docs"));
		await writeFile(path.join(workspace, "docs", "guide.md"), "guide");
		await writeFile(path.join(workspace, ".gitignore"), "ignored.md\n");
		await writeFile(path.join(workspace, "ignored.md"), "ignored but present");
		await writeFile(path.join(outside, "secret.md"), "secret");
		await symlink(path.join(outside, "secret.md"), path.join(workspace, "escaped.md"));
		const authorize = vi.fn(async () => undefined);
		const service = new FilesService({ authorize, gitStatus: async () => null });

		await expect(
			service.existingPaths(workspace, [
				"docs/guide.md",
				"missing.md",
				"docs",
				"ignored.md",
				"escaped.md",
				"../secret.md",
				"docs/guide.md",
			]),
		).resolves.toEqual(["docs/guide.md", "ignored.md"]);
		expect(authorize).toHaveBeenCalledTimes(1);
	});

	it("rejects traversal, escaped symlinks, and unauthorized roots", async () => {
		const workspace = await temporaryWorkspace();
		const outside = await temporaryWorkspace();
		await writeFile(path.join(outside, "secret.txt"), "secret");
		await symlink(path.join(outside, "secret.txt"), path.join(workspace, "escaped.txt"));
		const canonicalWorkspace = await realpath(workspace);
		const service = new FilesService({
			authorize: async (candidate) => {
				if (candidate !== canonicalWorkspace)
					throw new KernelError("VALIDATION", "Workspace not registered.");
			},
			gitStatus: async () => null,
		});

		await expect(service.read(workspace, "../secret.txt")).rejects.toMatchObject({
			code: "VALIDATION",
		});
		await expect(
			service.read(workspace, path.join(workspace, "escaped.txt")),
		).rejects.toMatchObject({
			code: "VALIDATION",
		});
		await expect(service.read(workspace, "escaped.txt")).rejects.toMatchObject({
			code: "VALIDATION",
		});
		await expect(service.read(workspace, "missing.txt")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(service.list(outside)).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("reads editable UTF-8, detects binary data, and truncates large text", async () => {
		const workspace = await temporaryWorkspace();
		await writeFile(path.join(workspace, "text.txt"), "héllo");
		await writeFile(path.join(workspace, "binary.dat"), Buffer.from([65, 0, 66]));
		await writeFile(path.join(workspace, "invalid.txt"), Buffer.from([0xc3, 0x28]));
		await writeFile(path.join(workspace, "large.txt"), "abcdef");
		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
		});

		const text = await service.read(workspace, "text.txt");
		expect(text).toMatchObject({
			kind: "text",
			contents: "héllo",
			byteLength: 6,
			truncated: false,
		});
		expect(text.kind === "text" && text.revision).toMatch(/^[a-f0-9]{64}$/);
		await expect(service.read(workspace, "binary.dat")).resolves.toEqual({
			kind: "unsupported",
			reason: "binary",
			byteLength: 3,
		});
		await expect(service.read(workspace, "invalid.txt")).resolves.toEqual({
			kind: "unsupported",
			reason: "binary",
			byteLength: 2,
		});
		const limitedService = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
			textLimitBytes: 4,
		});
		await expect(limitedService.read(workspace, "large.txt")).resolves.toEqual({
			kind: "text",
			contents: "abcd",
			byteLength: 6,
			truncated: true,
		});
	});

	it("preserves a UTF-8 BOM through an edit", async () => {
		const workspace = await temporaryWorkspace();
		const file = path.join(workspace, "bom.txt");
		await writeFile(file, Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("value\n")]));
		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
		});

		const opened = await service.read(workspace, "bom.txt");
		if (opened.kind !== "text" || !opened.revision) throw new Error("Expected editable text");
		expect(opened.contents).toBe("\ufeffvalue\n");

		await service.write(
			workspace,
			"bom.txt",
			opened.contents.replace("value", "changed"),
			opened.revision,
		);
		expect(await readFile(file)).toEqual(
			Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("changed\n")]),
		);
	});

	it("previews supported images and defers HTML and PDF previews", async () => {
		const workspace = await temporaryWorkspace();
		await writeFile(path.join(workspace, "pixel.png"), Buffer.from([1, 2, 3]));
		await writeFile(path.join(workspace, "index.html"), "<h1>Hello</h1>");
		await writeFile(path.join(workspace, "doc.pdf"), "%PDF");
		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
		});

		await expect(service.read(workspace, "pixel.png")).resolves.toEqual({
			kind: "image",
			mimeType: "image/png",
			base64: "AQID",
			byteLength: 3,
		});
		await expect(service.read(workspace, "index.html")).resolves.toMatchObject({
			kind: "unsupported",
			reason: "preview-deferred",
		});
		await expect(service.read(workspace, "doc.pdf")).resolves.toMatchObject({
			kind: "unsupported",
			reason: "preview-deferred",
		});
		const limitedService = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
			imageLimitBytes: 2,
		});
		await expect(limitedService.read(workspace, "pixel.png")).resolves.toEqual({
			kind: "unsupported",
			reason: "too-large",
			byteLength: 3,
		});
	});

	it("degrades to null when the injected git status lookup rejects", async () => {
		const workspace = await temporaryWorkspace();
		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => {
				throw new Error("git exploded");
			},
		});

		await expect(service.gitStatus(workspace)).resolves.toBeNull();
	});

	it("saves atomically, preserves mode, detects conflicts, and permits explicit overwrite", async () => {
		const workspace = await temporaryWorkspace();
		const file = path.join(workspace, "script.sh");
		await writeFile(file, "one\n", { mode: 0o755 });
		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
		});
		const opened = await service.read(workspace, "script.sh");
		if (opened.kind !== "text" || !opened.revision) throw new Error("Expected editable text");

		const originalMode = (await stat(file)).mode & 0o777;
		const saved = await service.write(workspace, "script.sh", "two\n", opened.revision);
		expect(saved.status).toBe("saved");
		expect((await stat(file)).mode & 0o777).toBe(originalMode);
		await writeFile(file, "external\n", { mode: 0o755 });

		const conflict = await service.write(
			workspace,
			"script.sh",
			"three\n",
			saved.status === "saved" ? saved.revision : "",
		);
		expect(conflict).toMatchObject({ status: "conflict" });
		expect(await readFile(file, "utf8")).toBe("external\n");

		const overwritten = await service.write(
			workspace,
			"script.sh",
			"three\n",
			saved.status === "saved" ? saved.revision : "",
			true,
		);
		expect(overwritten.status).toBe("saved");
		expect(await readFile(file, "utf8")).toBe("three\n");
	});

	describe("binary table files", () => {
		// Synthetic byte layouts: only the container magic matters to the
		// service; decoding is the renderer's (Sift's) job.
		const parquetBytes = Buffer.from("PAR1\x01\x02\x03PAR1", "latin1");

		function tableService(tableLimitBytes?: number): FilesService {
			return new FilesService({
				authorize: async () => undefined,
				gitStatus: async () => null,
				...(tableLimitBytes !== undefined ? { tableLimitBytes } : {}),
			});
		}

		it("reads Parquet files as bounded binary tables with a revision", async () => {
			const workspace = await temporaryWorkspace();
			await writeFile(path.join(workspace, "data.parquet"), parquetBytes);
			const service = tableService();

			const parquet = await service.read(workspace, "data.parquet");
			expect(parquet).toMatchObject({
				kind: "table",
				format: "parquet",
				base64: parquetBytes.toString("base64"),
				byteLength: parquetBytes.byteLength,
			});
			expect(parquet.kind === "table" && parquet.revision).toMatch(/^[a-f0-9]{64}$/);
		});

		it("does not treat Arrow IPC files or Feather as tables", async () => {
			// Sift's binary loader only accepts uncompressed Arrow IPC streams.
			const workspace = await temporaryWorkspace();
			await writeFile(path.join(workspace, "data.arrow"), Buffer.from("ARROW1\0\0ARROW1"));
			await writeFile(path.join(workspace, "data.feather"), Buffer.from("ARROW1\0\0ARROW1"));
			const service = tableService();

			for (const name of ["data.arrow", "data.feather"]) {
				await expect(service.read(workspace, name)).resolves.not.toMatchObject({ kind: "table" });
			}
		});

		it("refuses table files over the byte limit without reading them into the result", async () => {
			const workspace = await temporaryWorkspace();
			await writeFile(path.join(workspace, "big.parquet"), parquetBytes);

			await expect(
				tableService(parquetBytes.byteLength - 1).read(workspace, "big.parquet"),
			).resolves.toEqual({
				kind: "unsupported",
				reason: "too-large",
				byteLength: parquetBytes.byteLength,
			});
			expect(tableReads.allocations).toEqual([]);
		});

		it("rejects table files whose container magic does not match the extension", async () => {
			const workspace = await temporaryWorkspace();
			await writeFile(path.join(workspace, "fake.parquet"), "a,b\n1,2\n");
			await writeFile(path.join(workspace, "truncated.parquet"), "PAR1\x01\x02");
			await writeFile(path.join(workspace, "empty.parquet"), "");
			const service = tableService();

			for (const name of ["fake.parquet", "truncated.parquet", "empty.parquet"]) {
				await expect(service.read(workspace, name)).resolves.toMatchObject({
					kind: "unsupported",
					reason: "invalid-table",
				});
			}
		});

		it("applies the workspace and symlink boundary to table reads", async () => {
			const workspace = await temporaryWorkspace();
			const outside = await temporaryWorkspace();
			await writeFile(path.join(outside, "secret.parquet"), parquetBytes);
			await symlink(path.join(outside, "secret.parquet"), path.join(workspace, "link.parquet"));
			const service = tableService();

			await expect(service.read(workspace, "link.parquet")).rejects.toMatchObject({
				code: "VALIDATION",
			});
			await expect(service.read(workspace, "../secret.parquet")).rejects.toMatchObject({
				code: "VALIDATION",
			});
		});

		it("assembles a table from short reads instead of reporting it invalid", async () => {
			const workspace = await temporaryWorkspace();
			await writeFile(path.join(workspace, "data.parquet"), parquetBytes);
			tableReads.maxChunk = 1;

			await expect(tableService().read(workspace, "data.parquet")).resolves.toMatchObject({
				kind: "table",
				base64: parquetBytes.toString("base64"),
				byteLength: parquetBytes.byteLength,
			});
		});

		it("sizes the read buffer from the file, not the table cap", async () => {
			const workspace = await temporaryWorkspace();
			await writeFile(path.join(workspace, "small.parquet"), parquetBytes);

			await tableService().read(workspace, "small.parquet");

			expect(tableReads.allocations).toEqual([parquetBytes.byteLength + 1]);
		});

		it("reads a file that grew after stat in full when it stays within the cap", async () => {
			const workspace = await temporaryWorkspace();
			const file = path.join(workspace, "growing.parquet");
			const grown = Buffer.concat([parquetBytes, Buffer.from("PAR1")]);
			await writeFile(file, parquetBytes);
			tableReads.beforeFirstRead = () => writeFile(file, grown);

			await expect(tableService(1024).read(workspace, "growing.parquet")).resolves.toMatchObject({
				kind: "table",
				base64: grown.toString("base64"),
				byteLength: grown.byteLength,
			});
		});

		it("refuses a file that grew past the cap after stat", async () => {
			const workspace = await temporaryWorkspace();
			const file = path.join(workspace, "growing.parquet");
			await writeFile(file, parquetBytes);
			tableReads.beforeFirstRead = () =>
				writeFile(file, Buffer.concat([parquetBytes, Buffer.alloc(64), Buffer.from("PAR1")]));

			await expect(
				tableService(parquetBytes.byteLength + 8).read(workspace, "growing.parquet"),
			).resolves.toMatchObject({ kind: "unsupported", reason: "too-large" });
		});

		it("keeps CSV and TSV on the editable text path", async () => {
			const workspace = await temporaryWorkspace();
			await writeFile(path.join(workspace, "data.csv"), "name,score\nÅsa,1\n");
			await writeFile(path.join(workspace, "data.tsv"), "name\tscore\n");
			const service = tableService();

			const csv = await service.read(workspace, "data.csv");
			expect(csv).toMatchObject({ kind: "text", contents: "name,score\nÅsa,1\n" });
			expect(csv.kind === "text" && csv.revision).toMatch(/^[a-f0-9]{64}$/);
			await expect(service.read(workspace, "data.tsv")).resolves.toMatchObject({ kind: "text" });
		});
	});

	it("degrades to null when the injected git status lookup rejects", async () => {
		const workspace = await temporaryWorkspace();
		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => {
				throw new Error("git exploded");
			},
		});

		await expect(service.gitStatus(workspace)).resolves.toBeNull();
	});

	it("saves atomically, preserves mode, detects conflicts, and permits explicit overwrite", async () => {
		const workspace = await temporaryWorkspace();
		const file = path.join(workspace, "script.sh");
		await writeFile(file, "one\n", { mode: 0o755 });
		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
		});
		const opened = await service.read(workspace, "script.sh");
		if (opened.kind !== "text" || !opened.revision) throw new Error("Expected editable text");

		const originalMode = (await stat(file)).mode & 0o777;
		const saved = await service.write(workspace, "script.sh", "two\n", opened.revision);
		expect(saved.status).toBe("saved");
		expect((await stat(file)).mode & 0o777).toBe(originalMode);
		await writeFile(file, "external\n", { mode: 0o755 });

		const conflict = await service.write(
			workspace,
			"script.sh",
			"three\n",
			saved.status === "saved" ? saved.revision : "",
		);
		expect(conflict).toMatchObject({ status: "conflict" });
		expect(await readFile(file, "utf8")).toBe("external\n");

		const overwritten = await service.write(
			workspace,
			"script.sh",
			"three\n",
			saved.status === "saved" ? saved.revision : "",
			true,
		);
		expect(overwritten.status).toBe("saved");
		expect(await readFile(file, "utf8")).toBe("three\n");
	});

	describe("resolveFileLink", () => {
		async function writeWorkspaceFile(workspace: string, relativePath: string): Promise<void> {
			await mkdir(path.dirname(path.join(workspace, relativePath)), { recursive: true });
			await writeFile(path.join(workspace, relativePath), relativePath);
		}

		function serviceFor(options: { scanLimit?: number; fileSystem?: typeof fs } = {}) {
			return new FilesService({
				authorize: async () => undefined,
				gitStatus: async () => null,
				...(options.fileSystem ? { fileSystem: options.fileSystem } : {}),
				...(options.scanLimit !== undefined ? { resolveScanLimit: options.scanLimit } : {}),
			});
		}

		it("returns exact for a file at the root", async () => {
			const workspace = await temporaryWorkspace();
			await writeWorkspaceFile(workspace, "src/a.ts");

			await expect(serviceFor().resolveFileLink(workspace, "src/a.ts")).resolves.toEqual({
				kind: "exact",
				paths: ["src/a.ts"],
				truncated: false,
			});
		});

		it("returns the one suffix match for a link written against a subfolder", async () => {
			const workspace = await temporaryWorkspace();
			await writeWorkspaceFile(workspace, "pkg/src/a.ts");

			await expect(serviceFor().resolveFileLink(workspace, "src/a.ts")).resolves.toEqual({
				kind: "matches",
				paths: ["pkg/src/a.ts"],
				truncated: false,
			});
		});

		it("rejects a basename match in a different directory", async () => {
			const workspace = await temporaryWorkspace();
			await writeWorkspaceFile(workspace, "lib/a.ts");

			await expect(serviceFor().resolveFileLink(workspace, "src/a.ts")).resolves.toEqual({
				kind: "none",
				paths: [],
				truncated: false,
			});
		});

		it("requires a path-segment boundary before the link path", async () => {
			const workspace = await temporaryWorkspace();
			await writeWorkspaceFile(workspace, "xsrc/a.ts");

			await expect(serviceFor().resolveFileLink(workspace, "src/a.ts")).resolves.toMatchObject({
				kind: "none",
			});
		});

		it("excludes matches in gitignored directories", async () => {
			const workspace = await temporaryWorkspace();
			await writeFile(path.join(workspace, ".gitignore"), "node_modules/\n.venv/\n");
			await writeWorkspaceFile(workspace, "node_modules/x/src/a.ts");
			await writeWorkspaceFile(workspace, ".venv/lib/site-packages/src/a.ts");
			await writeWorkspaceFile(workspace, "pkg/src/a.ts");

			await expect(serviceFor().resolveFileLink(workspace, "src/a.ts")).resolves.toEqual({
				kind: "matches",
				paths: ["pkg/src/a.ts"],
				truncated: false,
			});
		});

		it("does not let gitignored copies use up the scan limit", async () => {
			const workspace = await temporaryWorkspace();
			await writeFile(path.join(workspace, ".gitignore"), ".venv/\n");
			for (const index of [1, 2, 3, 4]) {
				await writeWorkspaceFile(workspace, `.venv/p${String(index)}/__init__.py`);
			}
			await writeWorkspaceFile(workspace, "src/pkg/__init__.py");

			await expect(
				serviceFor({ scanLimit: 3 }).resolveFileLink(workspace, "pkg/__init__.py"),
			).resolves.toEqual({ kind: "matches", paths: ["src/pkg/__init__.py"], truncated: false });
		});

		it("still searches node_modules when it is not gitignored", async () => {
			const workspace = await temporaryWorkspace();
			await writeWorkspaceFile(workspace, "node_modules/x/src/a.ts");

			await expect(serviceFor().resolveFileLink(workspace, "src/a.ts")).resolves.toEqual({
				kind: "matches",
				paths: ["node_modules/x/src/a.ts"],
				truncated: false,
			});
		});

		it("excludes matches under .git", async () => {
			const workspace = await temporaryWorkspace();
			await writeWorkspaceFile(workspace, ".git/src/a.ts");

			await expect(serviceFor().resolveFileLink(workspace, "src/a.ts")).resolves.toMatchObject({
				kind: "none",
			});
		});

		it("excludes copies inside the main repo's .kilo/worktrees directory", async () => {
			const workspace = await temporaryWorkspace();
			await writeWorkspaceFile(workspace, ".kilo/worktrees/wt-one/src/a.ts");
			await writeWorkspaceFile(workspace, "pkg/src/a.ts");

			await expect(serviceFor().resolveFileLink(workspace, "src/a.ts")).resolves.toEqual({
				kind: "matches",
				paths: ["pkg/src/a.ts"],
				truncated: false,
			});
		});

		it("returns none when the only copy lives in a worktree", async () => {
			const workspace = await temporaryWorkspace();
			await writeWorkspaceFile(workspace, ".kilo/worktrees/wt-one/src/a.ts");

			await expect(serviceFor().resolveFileLink(workspace, "src/a.ts")).resolves.toEqual({
				kind: "none",
				paths: [],
				truncated: false,
			});
		});

		it("does not search nested worktrees from inside a worktree root", async () => {
			const main = await temporaryWorkspace();
			const worktree = path.join(main, ".kilo", "worktrees", "wt-one");
			await writeWorkspaceFile(worktree, ".kilo/worktrees/wt-two/src/a.ts");

			await expect(serviceFor().resolveFileLink(worktree, "src/a.ts")).resolves.toEqual({
				kind: "none",
				paths: [],
				truncated: false,
			});
		});

		it("finds bracketed Next.js route names literally", async () => {
			const workspace = await temporaryWorkspace();
			await writeWorkspaceFile(workspace, "web/app/[id]/page.tsx");

			await expect(serviceFor().resolveFileLink(workspace, "app/[id]/page.tsx")).resolves.toEqual({
				kind: "matches",
				paths: ["web/app/[id]/page.tsx"],
				truncated: false,
			});
		});

		it("does not return a symlink whose target is outside the root", async () => {
			const workspace = await temporaryWorkspace();
			const outside = await temporaryWorkspace();
			await writeFile(path.join(outside, "secret.ts"), "secret");
			await mkdir(path.join(workspace, "pkg", "src"), { recursive: true });
			await symlink(path.join(outside, "secret.ts"), path.join(workspace, "pkg", "src", "a.ts"));

			await expect(serviceFor().resolveFileLink(workspace, "src/a.ts")).resolves.toMatchObject({
				kind: "none",
				paths: [],
			});
		});

		it("stops walking at the limit and reports truncation", async () => {
			const workspace = await temporaryWorkspace();
			for (const index of [1, 2, 3, 4, 5]) {
				await writeWorkspaceFile(workspace, `d${String(index)}/lib/a.ts`);
			}

			await expect(
				serviceFor({ scanLimit: 3 }).resolveFileLink(workspace, "src/a.ts"),
			).resolves.toEqual({ kind: "none", paths: [], truncated: true });
		});

		it("returns none when nothing matches", async () => {
			const workspace = await temporaryWorkspace();
			await writeWorkspaceFile(workspace, "other.ts");

			await expect(serviceFor().resolveFileLink(workspace, "src/a.ts")).resolves.toEqual({
				kind: "none",
				paths: [],
				truncated: false,
			});
		});

		it("skips an unreadable subdirectory and still finds matches elsewhere", async () => {
			const workspace = await temporaryWorkspace();
			await writeWorkspaceFile(workspace, "locked/inner.txt");
			await writeWorkspaceFile(workspace, "pkg/src/a.ts");
			const lockedDirectory = path.join(workspace, "locked");
			const fileSystem = fakeFileSystem((directory) => directory === lockedDirectory);

			await expect(
				serviceFor({ fileSystem }).resolveFileLink(workspace, "src/a.ts"),
			).resolves.toEqual({ kind: "matches", paths: ["pkg/src/a.ts"], truncated: false });
		});

		it("shares one walk between concurrent calls for the same basename", async () => {
			const workspace = await temporaryWorkspace();
			await writeWorkspaceFile(workspace, "pkg/src/a.ts");
			await writeWorkspaceFile(workspace, "pkg/lib/a.ts");
			const root = await realpath(workspace);
			let rootReads = 0;
			const countingFileSystem = {
				...fs,
				readdir: ((
					directory: fs.PathLike,
					options: unknown,
					callback: (error: NodeJS.ErrnoException | null, entries?: unknown) => void,
				) => {
					// The walker passes forward-slash paths on Windows; compare native forms.
					if (path.resolve(String(directory)) === root) rootReads += 1;
					return (fs.readdir as (...args: unknown[]) => unknown)(directory, options, callback);
				}) as typeof fs.readdir,
			};
			const service = serviceFor({ fileSystem: countingFileSystem });
			await service.resolveFileLink(workspace, "src/a.ts");
			const rootReadsPerWalk = rootReads;
			rootReads = 0;

			const [first, second] = await Promise.all([
				service.resolveFileLink(workspace, "src/a.ts"),
				service.resolveFileLink(workspace, "lib/a.ts"),
			]);

			expect(rootReadsPerWalk).toBeGreaterThan(0);
			expect(rootReads).toBe(rootReadsPerWalk);
			expect(first.paths).toEqual(["pkg/src/a.ts"]);
			expect(second.paths).toEqual(["pkg/lib/a.ts"]);
		});

		it("rejects a link containing a parent segment with a validation error", async () => {
			const workspace = await temporaryWorkspace();

			const rejection = await serviceFor()
				.resolveFileLink(workspace, "../secret.ts")
				.catch((error: unknown) => error);

			expect(rejection).toBeInstanceOf(KernelError);
			expect(rejection).toMatchObject({ code: "VALIDATION" });
		});
	});
});
