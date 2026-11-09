import { link, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { KvStore } from "@kilo-desktop/kernel";

import { localModelSchema, type LocalModel } from "../contracts/index.js";
import type { PersistedLocalModels } from "./models/LocalModelRegistry.js";

export interface OriginLocalInferenceStore extends PersistedLocalModels {
	/** Origin's saved models and settings were taken over (once). */
	importedFromOrigin?: boolean;
}

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

function relativeWithin(directory: string, file: string): string | null {
	const relative = path.relative(directory, file);
	return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : null;
}

async function isSameFile(a: string, b: string): Promise<boolean> {
	try {
		const [first, second] = await Promise.all([stat(a), stat(b)]);
		return first.dev === second.dev && first.ino === second.ino;
	} catch {
		return false;
	}
}

/**
 * Hard-links one of origin's downloaded models into this plugin's folder and
 * returns the path to register. A link from an earlier, interrupted import is
 * reused; a different file already there is never overwritten, and a link the
 * filesystem refuses (another volume, no hard-link support) keeps origin's path.
 */
async function adoptModelFile(
	file: string,
	originModels: string,
	ownModels: string,
): Promise<string> {
	const relative = relativeWithin(originModels, file);
	if (!relative) return file;
	const target = path.join(ownModels, relative);
	try {
		await mkdir(path.dirname(target), { recursive: true });
		await link(file, target);
		return target;
	} catch (error) {
		const exists = (error as NodeJS.ErrnoException).code === "EEXIST";
		return exists && (await isSameFile(file, target)) ? target : file;
	}
}

/** Origin's model, its file linked here when origin downloaded it; only a file here is the app's to delete. */
async function adoptModel(
	model: LocalModel,
	originModels: string,
	ownModels: string,
): Promise<LocalModel> {
	const adopted = await adoptModelFile(model.path, originModels, ownModels);
	const inOwnFolder = relativeWithin(ownModels, adopted) !== null;
	return {
		...model,
		path: adopted,
		...(model.managedFile && !inOwnFolder ? { managedFile: false } : {}),
	};
}

function readModels(value: unknown): LocalModel[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		const parsed = localModelSchema.safeParse(entry);
		return parsed.success ? [parsed.data] : [];
	});
}

/**
 * Takes over what origin's local-inference plugin saved in its storage folder
 * once: its registry (`models.json`: models, server settings, enabled,
 * Anaconda Desktop import) and the models it downloaded into its own folder.
 *
 * Downloaded models are hard-linked, not moved or copied: they are often
 * several GB, and origin's files must stay put so a downgrade still finds
 * them. Linking is idempotent, so a crash between linking and saving the
 * registry is finished on the next launch. Nothing is overwritten: origin's
 * models join any registered here meanwhile (downloads, Anaconda Desktop's
 * import) unless one with the same path or id is there, and settings or the
 * enabled switch saved here win. Entries that don't validate are skipped. A
 * missing or unparseable registry counts as imported; a read that fails is
 * retried next launch.
 */
export async function importOriginLocalInference(options: {
	readonly originDir: string;
	readonly storageDir: string;
	readonly store: KvStore<OriginLocalInferenceStore>;
}): Promise<void> {
	const { originDir, storageDir, store } = options;
	if (store.snapshot().importedFromOrigin === true) return;
	const origin = await readJson(path.join(originDir, "models.json"));
	if (!origin) {
		store.set({ importedFromOrigin: true });
		return;
	}
	const originModels = path.join(originDir, "models");
	const ownModels = path.join(storageDir, "models");
	const adopted = await Promise.all(
		readModels(origin.models).map((model) => adoptModel(model, originModels, ownModels)),
	);
	const current = store.snapshot();
	const paths = new Set(current.models.map((model) => model.path));
	const ids = new Set(current.models.map((model) => model.id));
	const added = adopted.filter((model) => !paths.has(model.path) && !ids.has(model.id));
	store.set({
		models: [...current.models, ...added],
		...(current.enabled === undefined && typeof origin.enabled === "boolean"
			? { enabled: origin.enabled }
			: {}),
		...(current.settings === undefined && origin.settings && typeof origin.settings === "object"
			? { settings: origin.settings as NonNullable<PersistedLocalModels["settings"]> }
			: {}),
		...(origin.anacondaDesktopModelsImported === true
			? { anacondaDesktopModelsImported: true }
			: {}),
		importedFromOrigin: true,
	});
}
