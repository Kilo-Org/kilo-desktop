import type { KvStore, PluginStorage } from "@kilo-desktop/kernel";

import { DEFAULT_NOTEBOOK_SETTINGS, type NotebookSettings } from "../../contracts/index.js";

type SettingsPatch = { readonly [K in keyof NotebookSettings]?: NotebookSettings[K] | undefined };

export interface PersistedSettings extends Record<string, unknown>, NotebookSettings {
	/** Settings the person set in this app; a retried origin import never overwrites these. */
	chosenHere: string[];
}

export interface PersistedNotebookState extends Record<string, unknown> {
	/** Untitled notebooks this app created; "Trust new notebooks" applies only to these. */
	createdNotebookIds: string[];
	/** Notebooks whose environment.yml decision is settled, so reopening never asks again. */
	preparedNotebookIds: string[];
	/** Origin's saved settings and notebook facts were taken over (once). */
	importedFromOrigin: boolean;
}

/** Bounds both lists; the oldest notebooks are the least likely to be reopened. */
const MAX_TRACKED_NOTEBOOKS = 1_000;

function booleanOr(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function idList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

/** User-facing notebook preferences, file-backed via `mainSdk.storage.kv`. */
export class NotebookSettingsStore {
	readonly #store: KvStore<PersistedSettings>;

	constructor(storage: Pick<PluginStorage, "kv">) {
		this.#store = storage.kv<PersistedSettings>({
			namespace: "settings",
			defaults: { ...DEFAULT_NOTEBOOK_SETTINGS, chosenHere: [] },
		});
	}

	get(): NotebookSettings {
		const snapshot = this.#store.snapshot();
		return {
			autoCreateEnvironmentFile: booleanOr(
				snapshot.autoCreateEnvironmentFile,
				DEFAULT_NOTEBOOK_SETTINGS.autoCreateEnvironmentFile,
			),
			trustNewNotebooks: booleanOr(
				snapshot.trustNewNotebooks,
				DEFAULT_NOTEBOOK_SETTINGS.trustNewNotebooks,
			),
		};
	}

	/** A change the person made here. */
	update(patch: SettingsPatch): NotebookSettings {
		const chosen = Object.keys(patch).filter(
			(key) => patch[key as keyof NotebookSettings] !== undefined,
		);
		return this.#apply(patch, [...new Set([...this.#chosenHere(), ...chosen])]);
	}

	/** Origin's values, applied only to settings not chosen here. */
	adoptOrigin(patch: SettingsPatch): NotebookSettings {
		const chosen = new Set(this.#chosenHere());
		const unchosen = Object.fromEntries(
			Object.entries(patch).filter(([key]) => !chosen.has(key)),
		) as SettingsPatch;
		return this.#apply(unchosen, [...chosen]);
	}

	#apply(patch: SettingsPatch, chosenHere: string[]): NotebookSettings {
		const current = this.get();
		const next: NotebookSettings = {
			autoCreateEnvironmentFile:
				patch.autoCreateEnvironmentFile ?? current.autoCreateEnvironmentFile,
			trustNewNotebooks: patch.trustNewNotebooks ?? current.trustNewNotebooks,
		};
		this.#store.set({ ...next, chosenHere });
		return next;
	}

	#chosenHere(): string[] {
		return idList(this.#store.get("chosenHere"));
	}
}

/** Per-notebook facts the app must remember across restarts. */
export class NotebookStateStore {
	readonly #store: KvStore<PersistedNotebookState>;

	constructor(storage: Pick<PluginStorage, "kv">) {
		this.#store = storage.kv<PersistedNotebookState>({
			namespace: "notebook-state",
			defaults: { createdNotebookIds: [], preparedNotebookIds: [], importedFromOrigin: false },
		});
	}

	isCreatedHere(notebookId: string): boolean {
		return idList(this.#store.get("createdNotebookIds")).includes(notebookId);
	}

	markCreatedHere(notebookId: string): void {
		this.#add("createdNotebookIds", notebookId);
	}

	isPrepared(notebookId: string): boolean {
		return idList(this.#store.get("preparedNotebookIds")).includes(notebookId);
	}

	markPrepared(notebookId: string): void {
		this.#add("preparedNotebookIds", notebookId);
	}

	get importedFromOrigin(): boolean {
		return this.#store.get("importedFromOrigin") === true;
	}

	/** Adds origin's facts to the ones saved here, once. */
	adoptOrigin(origin: { createdNotebookIds: unknown; preparedNotebookIds: unknown }): void {
		const merge = (key: "createdNotebookIds" | "preparedNotebookIds", from: unknown) =>
			[...new Set([...idList(from), ...idList(this.#store.get(key))])].slice(
				-MAX_TRACKED_NOTEBOOKS,
			);
		this.#store.set({
			createdNotebookIds: merge("createdNotebookIds", origin.createdNotebookIds),
			preparedNotebookIds: merge("preparedNotebookIds", origin.preparedNotebookIds),
			importedFromOrigin: true,
		});
	}

	markImportedFromOrigin(): void {
		this.#store.set({ importedFromOrigin: true });
	}

	#add(key: "createdNotebookIds" | "preparedNotebookIds", notebookId: string): void {
		const ids = idList(this.#store.get(key));
		if (ids.includes(notebookId)) return;
		this.#store.set({ [key]: [...ids, notebookId].slice(-MAX_TRACKED_NOTEBOOKS) });
	}
}
