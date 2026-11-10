import { readFile } from "node:fs/promises";
import path from "node:path";

import type { NotebookSettingsStore, NotebookStateStore } from "./settings/NotebookSettingsStore";

/** null when the file is missing or isn't a JSON object; throws when it can't be read now. */
async function readJson(file: string): Promise<Record<string, unknown> | null> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: null;
}

const booleanOrUndefined = (value: unknown): boolean | undefined =>
	typeof value === "boolean" ? value : undefined;

/**
 * Takes over what origin's notebook plugin saved in its storage folder
 * (`settings.json`, `notebook-state.json`) once: its settings (beneath ones
 * changed here), and the notebooks it created and prepared, added to any
 * recorded here. Missing files and files that aren't JSON count as imported;
 * one that can't be read is retried next launch.
 */
export async function importOriginNotebookData(
	originDir: string,
	settings: NotebookSettingsStore,
	state: NotebookStateStore,
): Promise<void> {
	if (state.importedFromOrigin) return;
	const [originSettings, originState] = await Promise.all([
		readJson(path.join(originDir, "settings.json")),
		readJson(path.join(originDir, "notebook-state.json")),
	]);
	if (originSettings) {
		settings.adoptOrigin({
			autoCreateEnvironmentFile: booleanOrUndefined(originSettings.autoCreateEnvironmentFile),
			trustNewNotebooks: booleanOrUndefined(originSettings.trustNewNotebooks),
		});
	}
	if (originState) {
		state.adoptOrigin({
			createdNotebookIds: originState.createdNotebookIds,
			preparedNotebookIds: originState.preparedNotebookIds,
		});
	} else state.markImportedFromOrigin();
}
