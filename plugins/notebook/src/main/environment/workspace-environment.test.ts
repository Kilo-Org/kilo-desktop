import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findProjectFile, WorkspaceEnvironment } from "./workspace-environment";

const NOTEBOOK_ID = "2c7f2b1e-7e0a-4c1f-9d57-6a8b2f0c9e11";

let home: string;
let workspace: string;

beforeEach(async () => {
	home = await mkdtemp(path.join(os.tmpdir(), "notebook-env-"));
	workspace = path.join(home, "projects", "analysis");
	await mkdir(workspace, { recursive: true });
});

afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

function preparer(autoCreateEnvironmentFile = true) {
	const prepared = new Set<string>();
	const environment = new WorkspaceEnvironment({
		settings: () => ({ autoCreateEnvironmentFile }),
		state: {
			isPrepared: (id) => prepared.has(id),
			markPrepared: (id) => void prepared.add(id),
		},
		homeDirectory: home,
	});
	return { environment, prepared };
}

describe("findProjectFile", () => {
	it("finds the nearest project file the way runtimed does", async () => {
		await writeFile(path.join(home, "projects", "pyproject.toml"), "");
		expect(await findProjectFile(workspace, home)).toBe(
			path.join(home, "projects", "pyproject.toml"),
		);

		await writeFile(path.join(workspace, "environment.yml"), "");
		await writeFile(path.join(workspace, "pixi.toml"), "");
		expect(await findProjectFile(workspace, home)).toBe(path.join(workspace, "pixi.toml"));
	});

	it("stops at a git root and never looks in the home directory", async () => {
		await writeFile(path.join(home, "environment.yml"), "");
		expect(await findProjectFile(workspace, home)).toBeUndefined();

		await writeFile(path.join(home, "projects", "pyproject.toml"), "");
		await mkdir(path.join(workspace, ".git"));
		expect(await findProjectFile(workspace, home)).toBeUndefined();
	});
});

describe("WorkspaceEnvironment", () => {
	it("creates a workspace environment.yml whose environment lives in the workspace", async () => {
		const { environment } = preparer();

		const result = await environment.prepare({
			notebookId: NOTEBOOK_ID,
			workingDirectory: workspace,
		});

		const file = path.join(workspace, "environment.yml");
		expect(result).toEqual({ outcome: "created", path: file });
		const contents = await readFile(file, "utf8");
		expect(contents).toContain("channels:\n  - defaults\n");
		expect(contents).toContain("dependencies:\n  - ipykernel\n");
		expect(contents).toContain(`prefix: ${JSON.stringify(path.join(workspace, ".conda"))}`);
	});

	it("leaves an existing project file in charge", async () => {
		await writeFile(path.join(home, "projects", "pyproject.toml"), "[project]\n");
		const { environment } = preparer();

		const result = await environment.prepare({
			notebookId: NOTEBOOK_ID,
			workingDirectory: workspace,
		});

		expect(result).toEqual({
			outcome: "existing",
			path: path.join(home, "projects", "pyproject.toml"),
		});
		await expect(readFile(path.join(workspace, "environment.yml"))).rejects.toThrow();
	});

	it("opens the notebook unchanged when auto-create is off, and never retrofits it", async () => {
		const request = { notebookId: NOTEBOOK_ID, workingDirectory: workspace };
		const off = preparer(false);

		expect(await off.environment.prepare(request)).toEqual({ outcome: "skipped" });
		await expect(readFile(path.join(workspace, "environment.yml"))).rejects.toThrow();

		// Turning the setting on later leaves a notebook that already opened alone.
		const on = new WorkspaceEnvironment({
			settings: () => ({ autoCreateEnvironmentFile: true }),
			state: {
				isPrepared: (id) => off.prepared.has(id),
				markPrepared: (id) => void off.prepared.add(id),
			},
			homeDirectory: home,
		});
		expect(await on.prepare(request)).toEqual({ outcome: "skipped" });
		await expect(readFile(path.join(workspace, "environment.yml"))).rejects.toThrow();
	});

	it.each([
		["a uv lockfile", "uv.lock"],
		["a uv virtual environment", path.join(".venv", "pyvenv.cfg")],
	])("leaves a workspace with %s on uv", async (_label, marker) => {
		await mkdir(path.dirname(path.join(workspace, marker)), { recursive: true });
		await writeFile(path.join(workspace, marker), "");
		const { environment } = preparer();

		const result = await environment.prepare({
			notebookId: NOTEBOOK_ID,
			workingDirectory: workspace,
		});

		expect(result).toEqual({ outcome: "uv", path: path.join(workspace, marker) });
		await expect(readFile(path.join(workspace, "environment.yml"))).rejects.toThrow();
	});

	it("does not create a file for a notebook that was already prepared without one", async () => {
		const { environment, prepared } = preparer();
		prepared.add(NOTEBOOK_ID);

		expect(
			await environment.prepare({ notebookId: NOTEBOOK_ID, workingDirectory: workspace }),
		).toEqual({ outcome: "skipped" });
	});

	it("reports an unusable workspace instead of throwing", async () => {
		const { environment } = preparer();

		expect(
			await environment.prepare({
				notebookId: NOTEBOOK_ID,
				workingDirectory: path.join(workspace, "missing"),
			}),
		).toMatchObject({ outcome: "failed" });
		expect(
			await environment.prepare({ notebookId: NOTEBOOK_ID, workingDirectory: "relative/dir" }),
		).toMatchObject({ outcome: "failed" });
	});
});
