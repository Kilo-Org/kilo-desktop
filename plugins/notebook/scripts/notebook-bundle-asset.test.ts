import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isNotebookBundle, stageNotebookBundle } from "./notebook-bundle-asset.js";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "notebook-bundle-"));
	directories.push(directory);
	return directory;
}

/** A minimal stand-in for nteract's `apps/notebook/dist`. */
async function writeBundle(directory: string): Promise<string> {
	const source = path.join(directory, "dist");
	await mkdir(path.join(source, "assets"), { recursive: true });
	await writeFile(
		path.join(source, "index.html"),
		'<html><script type="module" src="/assets/main-abc123.js"></script></html>',
	);
	await writeFile(path.join(source, "assets", "main-abc123.js"), "console.log(1)");
	return source;
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("isNotebookBundle", () => {
	it("accepts a built bundle", async () => {
		const source = await writeBundle(await temporaryDirectory());
		await expect(isNotebookBundle(source)).resolves.toBe(true);
	});

	it("rejects a directory with no index.html", async () => {
		// The likely mistake: pointing NTERACT_BUNDLE at the repo or app root
		// rather than at the built dist.
		const directory = await temporaryDirectory();
		await mkdir(path.join(directory, "src"), { recursive: true });
		await expect(isNotebookBundle(directory)).resolves.toBe(false);
	});

	it("rejects an index.html that references no built assets", async () => {
		// A source index.html parses as HTML but has no hashed entry chunk, so it
		// would ship and fail at runtime as a blank frame.
		const directory = await temporaryDirectory();
		await writeFile(path.join(directory, "index.html"), "<html><body>dev shell</body></html>");
		await expect(isNotebookBundle(directory)).resolves.toBe(false);
	});

	it("rejects a path that does not exist", async () => {
		await expect(isNotebookBundle(path.join(await temporaryDirectory(), "absent"))).resolves.toBe(
			false,
		);
	});
});

describe("stageNotebookBundle", () => {
	it("copies the bundle tree into the staging directory", async () => {
		const workspace = await temporaryDirectory();
		const source = await writeBundle(workspace);
		const destination = path.join(workspace, "build/notebook");

		await expect(
			stageNotebookBundle({
				destinationDirectory: destination,
				environment: { NTERACT_BUNDLE: source },
			}),
		).resolves.toBe(destination);

		// Lazy chunks matter as much as the shell — a missing one fails at runtime.
		await expect(
			readFile(path.join(destination, "assets", "main-abc123.js"), "utf8"),
		).resolves.toBe("console.log(1)");
	});

	it("stages nothing when no source is configured", async () => {
		const destination = path.join(await temporaryDirectory(), "build/notebook");
		await expect(
			stageNotebookBundle({ destinationDirectory: destination, environment: {} }),
		).resolves.toBeUndefined();
	});

	it("clears a stale bundle so an unset source cannot ship yesterday's UI", async () => {
		const workspace = await temporaryDirectory();
		const destination = path.join(workspace, "build/notebook");
		await mkdir(path.join(destination, "assets"), { recursive: true });
		await writeFile(path.join(destination, "index.html"), "stale");

		await expect(
			stageNotebookBundle({ destinationDirectory: destination, environment: {} }),
		).resolves.toBeUndefined();

		// A stale UI against a fresh daemon is a version skew nothing checks (D6).
		await expect(readFile(path.join(destination, "index.html"), "utf8")).rejects.toThrow();
	});

	it("replaces a previously staged bundle rather than merging into it", async () => {
		const workspace = await temporaryDirectory();
		const source = await writeBundle(workspace);
		const destination = path.join(workspace, "build/notebook");
		await mkdir(path.join(destination, "assets"), { recursive: true });
		await writeFile(path.join(destination, "assets", "orphan-xyz789.js"), "old chunk");

		await stageNotebookBundle({
			destinationDirectory: destination,
			environment: { NTERACT_BUNDLE: source },
		});

		await expect(
			readFile(path.join(destination, "assets", "orphan-xyz789.js"), "utf8"),
		).rejects.toThrow();
	});

	it("rejects a source that is not a built bundle instead of shipping it", async () => {
		const workspace = await temporaryDirectory();
		const notABundle = path.join(workspace, "nteract-repo");
		await mkdir(notABundle, { recursive: true });

		await expect(
			stageNotebookBundle({
				destinationDirectory: path.join(workspace, "build/notebook"),
				environment: { NTERACT_BUNDLE: notABundle },
			}),
		).rejects.toThrow(/not a built notebook bundle/);
	});

	it("ignores a whitespace-only source the way an unset one is ignored", async () => {
		const destination = path.join(await temporaryDirectory(), "build/notebook");
		await expect(
			stageNotebookBundle({
				destinationDirectory: destination,
				environment: { NTERACT_BUNDLE: "  " },
			}),
		).resolves.toBeUndefined();
	});
});
