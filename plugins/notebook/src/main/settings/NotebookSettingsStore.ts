import type { KvStore, MainSdk } from "@kilo-desktop/feature-sdk/main";

import { DEFAULT_NOTEBOOK_SETTINGS, type NotebookSettings } from "../../contracts/schemas.js";

interface PersistedSettings extends Record<string, unknown>, NotebookSettings {}

interface PersistedNotebookState extends Record<string, unknown> {
	/** Untitled notebooks this app created; "Trust new notebooks" applies only to these. */
	createdNotebookIds: string[];
	/** Notebooks whose environment.yml decision is settled, so reopening never asks again. */
	preparedNotebookIds: string[];
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

	constructor(sdk: MainSdk) {
		this.#store = sdk.storage.kv<PersistedSettings>({
			namespace: "settings",
			defaults: { ...DEFAULT_NOTEBOOK_SETTINGS },
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

	update(patch: { readonly [K in keyof NotebookSettings]?: NotebookSettings[K] | undefined }) {
		const current = this.get();
		const next: NotebookSettings = {
			autoCreateEnvironmentFile:
				patch.autoCreateEnvironmentFile ?? current.autoCreateEnvironmentFile,
			trustNewNotebooks: patch.trustNewNotebooks ?? current.trustNewNotebooks,
		};
		this.#store.set(next);
		return next;
	}
}

/** Per-notebook facts the app must remember across restarts. */
export class NotebookStateStore {
	readonly #store: KvStore<PersistedNotebookState>;

	constructor(sdk: MainSdk) {
		this.#store = sdk.storage.kv<PersistedNotebookState>({
			namespace: "notebook-state",
			defaults: { createdNotebookIds: [], preparedNotebookIds: [] },
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

	#add(key: "createdNotebookIds" | "preparedNotebookIds", notebookId: string): void {
		const ids = idList(this.#store.get(key));
		if (ids.includes(notebookId)) return;
		this.#store.set({ [key]: [...ids, notebookId].slice(-MAX_TRACKED_NOTEBOOKS) });
	}
}
