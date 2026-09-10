import { mkdtemp, mkdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";

import { FilesService } from "./FilesService.js";

const temporaryDirectories: string[] = [];

async function temporaryWorkspace(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "files-plugin-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map(async (directory) => {
			await import("node:fs/promises").then(({ rm }) => rm(directory, { recursive: true }));
		}),
	);
});

describe("FilesService", () => {
	it("lists POSIX paths while respecting nested gitignore files and hidden entries", async () => {
		const workspace = await temporaryWorkspace();
		await mkdir(path.join(workspace, "src", "generated"), { recursive: true });
		await writeFile(path.join(workspace, ".hidden"), "visible");
		await writeFile(path.join(workspace, ".gitignore"), "root-ignored.txt\n");
		await writeFile(path.join(workspace, "root-ignored.txt"), "ignored");
		await writeFile(path.join(workspace, "src", ".gitignore"), "generated/\n");
		await writeFile(path.join(workspace, "src", "index.ts"), "export {};");
		await writeFile(path.join(workspace, "src", "generated", "code.ts"), "ignored");

		const service = new FilesService({
			authorize: async () => undefined,
			gitStatus: async () => null,
		});
		await expect(service.list(workspace)).resolves.toEqual({
			paths: [".gitignore", ".hidden", "src/", "src/.gitignore", "src/index.ts"],
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
					throw new FeatureError("Workspace not registered.", "VALIDATION");
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
});
