/**
 * Gives new notebooks a workspace-owned conda environment.
 *
 * runtimed picks a notebook's environment by walking up from its working
 * directory to the nearest project file. For an untitled notebook in a
 * workspace with none, it would otherwise build a hidden environment in its own
 * cache. Writing `environment.yml` with a `prefix` inside the workspace makes
 * the daemon build the environment there instead, shared by every notebook in
 * the folder.
 *
 * Invariants:
 * - The file must exist before the notebook's room is created: the daemon
 *   auto-launches (and detects project files) as soon as the first peer joins.
 * - Existing project files are never overwritten or shadowed; discovery mirrors
 *   the daemon's walk so a parent project keeps control of its notebooks.
 * - A workspace that already has a uv environment (`uv.lock` or `.venv`) is left
 *   alone: its owner has chosen uv, and a conda file would take over its notebooks.
 * - Each notebook is decided once, and with the setting off nothing is written,
 *   so turning it on later never retrofits notebooks that already launched.
 * - Only default-trusted packages and channels are declared, so building the
 *   environment needs no dependency approval.
 */
import { constants } from "node:fs";
import { access, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { NotebookEnvironmentPreparation, NotebookSettings } from "../../contracts";

/** runtimed's precedence within one directory (`crates/runtimed/src/project_file.rs`). */
const PROJECT_FILES = ["pyproject.toml", "pixi.toml", "environment.yml", "environment.yaml"];

export const ENVIRONMENT_FILE_NAME = "environment.yml";
export const ENVIRONMENT_PREFIX_DIRECTORY = ".conda";

async function exists(target: string): Promise<boolean> {
	try {
		await access(target, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Nearest project file the daemon would select for `directory`. The walk stops
 * at a `.git` root, and at the home directory without checking it.
 */
export async function findProjectFile(
	directory: string,
	homeDirectory: string = os.homedir(),
): Promise<string | undefined> {
	let current = path.resolve(directory);
	const home = path.resolve(homeDirectory);
	for (;;) {
		if (current === home) return undefined;
		for (const name of PROJECT_FILES) {
			const candidate = path.join(current, name);
			if (await exists(candidate)) return candidate;
		}
		if (await exists(path.join(current, ".git"))) return undefined;
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/** A uv lockfile or virtual environment directly in the workspace. */
export async function findUvEnvironment(directory: string): Promise<string | undefined> {
	for (const candidate of [
		path.join(directory, "uv.lock"),
		path.join(directory, ".venv", "pyvenv.cfg"),
	]) {
		if (await exists(candidate)) return candidate;
	}
	return undefined;
}

/**
 * The daemon resolves `prefix` verbatim (never against the file's directory),
 * so it has to be absolute. JSON string quoting is valid YAML for any path.
 */
export function environmentFileContents(directory: string): string {
	const prefix = path.join(directory, ENVIRONMENT_PREFIX_DIRECTORY);
	return [
		"# Notebooks in this folder share one conda environment.",
		`# The environment is built in ${ENVIRONMENT_PREFIX_DIRECTORY}/ the first time a notebook starts.`,
		"channels:",
		"  - defaults",
		"dependencies:",
		"  - ipykernel",
		`prefix: ${JSON.stringify(prefix)}`,
		"",
	].join("\n");
}

/** Creates environment.yml; never replaces a file that appeared concurrently. */
export async function createEnvironmentFile(directory: string): Promise<string> {
	const target = path.join(directory, ENVIRONMENT_FILE_NAME);
	await writeFile(target, environmentFileContents(directory), { flag: "wx" });
	return target;
}

export interface NotebookPreparationState {
	isPrepared(notebookId: string): boolean;
	markPrepared(notebookId: string): void;
}

export interface PrepareEnvironmentRequest {
	readonly notebookId: string;
	readonly workingDirectory: string;
}

export interface WorkspaceEnvironmentOptions {
	readonly settings: () => Pick<NotebookSettings, "autoCreateEnvironmentFile">;
	readonly state: NotebookPreparationState;
	readonly homeDirectory?: string;
}

export class WorkspaceEnvironment {
	readonly #options: WorkspaceEnvironmentOptions;

	constructor(options: WorkspaceEnvironmentOptions) {
		this.#options = options;
	}

	async prepare(request: PrepareEnvironmentRequest): Promise<NotebookEnvironmentPreparation> {
		const { state } = this.#options;
		// The workspace is the user's own folder, not a server-owned base: it is
		// rejected unless absolute and an existing directory before any file access.
		// react-doctor-disable-next-line react-doctor/path-traversal-risk
		const directory = path.resolve(request.workingDirectory);
		if (!path.isAbsolute(request.workingDirectory)) {
			return { outcome: "failed", reason: "The workspace directory must be absolute." };
		}
		try {
			if (!(await stat(directory)).isDirectory()) {
				return { outcome: "failed", reason: "The workspace path is not a directory." };
			}
		} catch {
			return { outcome: "failed", reason: "The workspace directory does not exist." };
		}

		const existing = await findProjectFile(directory, this.#options.homeDirectory);
		if (existing) {
			state.markPrepared(request.notebookId);
			return { outcome: "existing", path: existing };
		}
		const uvEnvironment = await findUvEnvironment(directory);
		if (uvEnvironment) {
			state.markPrepared(request.notebookId);
			return { outcome: "uv", path: uvEnvironment };
		}
		if (
			state.isPrepared(request.notebookId) ||
			!this.#options.settings().autoCreateEnvironmentFile
		) {
			state.markPrepared(request.notebookId);
			return { outcome: "skipped" };
		}
		const target = path.join(directory, ENVIRONMENT_FILE_NAME);
		try {
			const created = await createEnvironmentFile(directory);
			state.markPrepared(request.notebookId);
			return { outcome: "created", path: created };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") {
				state.markPrepared(request.notebookId);
				return { outcome: "existing", path: target };
			}
			return {
				outcome: "failed",
				reason: `Could not create ${ENVIRONMENT_FILE_NAME}: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}
}
