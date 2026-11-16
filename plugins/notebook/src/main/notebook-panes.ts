import { KernelError, type DomainObjectHandle } from "@kilo-desktop/kernel";
import type { Pane, Panes } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	NOTEBOOK_PANE_KIND,
	NOTEBOOK_PANE_METADATA,
	notebookFileOf,
	notebookIdOf,
	type NotebookOpenFileResult,
} from "../contracts/index.js";

export interface NotebookPaneSummary {
	readonly notebook_id: string;
	readonly title: string;
	readonly active: boolean;
}

export interface NotebookPanesOptions {
	readonly panes: () => DomainObjectHandle<typeof Panes> | null;
	readonly openFile: (path: string) => Promise<NotebookOpenFileResult>;
	readonly createId: () => string;
}

const basename = (filePath: string) => filePath.replaceAll("\\", "/").split("/").at(-1) ?? filePath;

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : "The notebook file could not be opened.";

function withoutOpenState(metadata: Readonly<Record<string, string>>): Record<string, string> {
	const {
		[NOTEBOOK_PANE_METADATA.openState]: _state,
		[NOTEBOOK_PANE_METADATA.openError]: _error,
		...rest
	} = metadata;
	return rest;
}

/**
 * Gives Notebook panes their notebooks, in main. A pane opened without one
 * gets a new notebook id; a pane opened for a file (an opener, the agent, a
 * handed-over tab) shows `opening` while the runtime opens the file, then
 * the daemon's id for it and the file's name, or `error` and why. Each pane
 * resolves once at a time; asking again while it resolves waits for it.
 */
export class NotebookPanes {
	readonly #options: NotebookPanesOptions;
	readonly #resolving = new Map<string, Promise<Pane>>();

	constructor(options: NotebookPanesOptions) {
		this.#options = options;
	}

	/** The pane with its notebook; throws when the pane is gone or its file can't be opened. */
	resolve(workSessionId: string, paneId: string): Promise<Pane> {
		const key = `${workSessionId}\u0000${paneId}`;
		const pending = this.#resolving.get(key);
		if (pending) return pending;
		const resolving = this.#resolve(workSessionId, paneId).finally(() =>
			this.#resolving.delete(key),
		);
		this.#resolving.set(key, resolving);
		return resolving;
	}

	list(workSessionId: string): readonly NotebookPaneSummary[] {
		const panes = this.#options.panes()?.getState().byWorkSession[workSessionId];
		if (!panes) return [];
		return panes.panes.flatMap((pane) => {
			const notebookId = pane.kind === NOTEBOOK_PANE_KIND ? notebookIdOf(pane) : undefined;
			return notebookId
				? [{ notebook_id: notebookId, title: pane.title, active: pane.id === panes.activePaneId }]
				: [];
		});
	}

	/** The pane showing a notebook file, by its path. */
	findFile(workSessionId: string, notebookPath: string): Pane | undefined {
		return this.#notebookPanes(workSessionId).find((pane) => notebookFileOf(pane) === notebookPath);
	}

	/** Where a connected notebook is shown. */
	locate(notebookId: string): { readonly workSessionId: string; readonly pane: Pane } | undefined {
		const byWorkSession = this.#options.panes()?.getState().byWorkSession ?? {};
		for (const [workSessionId, panes] of Object.entries(byWorkSession)) {
			const pane = panes.panes.find(
				(candidate) =>
					candidate.kind === NOTEBOOK_PANE_KIND && notebookIdOf(candidate) === notebookId,
			);
			if (pane) return { workSessionId, pane };
		}
		return undefined;
	}

	#notebookPanes(workSessionId: string): readonly Pane[] {
		return (
			this.#options
				.panes()
				?.getState()
				.byWorkSession[workSessionId]?.panes.filter((pane) => pane.kind === NOTEBOOK_PANE_KIND) ??
			[]
		);
	}

	#current(workSessionId: string, paneId: string): Pane {
		const pane = this.#notebookPanes(workSessionId).find((candidate) => candidate.id === paneId);
		if (!pane) throw new KernelError("NOT_FOUND", "Notebook pane not found.");
		return pane;
	}

	async #resolve(workSessionId: string, paneId: string): Promise<Pane> {
		const panes = this.#options.panes();
		if (!panes) throw new KernelError("UNAVAILABLE", "Panes are unavailable.");
		const pane = this.#current(workSessionId, paneId);
		if (notebookIdOf(pane)) return pane;
		const file = notebookFileOf(pane);
		if (!file) {
			return panes.methods.update({
				workSessionId,
				paneId,
				metadata: {
					...pane.metadata,
					[NOTEBOOK_PANE_METADATA.notebookId]: this.#options.createId(),
				},
			});
		}

		await panes.methods.update({
			workSessionId,
			paneId,
			title: basename(file),
			metadata: {
				...withoutOpenState(pane.metadata),
				[NOTEBOOK_PANE_METADATA.notebookPath]: file,
				[NOTEBOOK_PANE_METADATA.openState]: "opening",
			},
		});
		let opened: NotebookOpenFileResult;
		try {
			opened = await this.#options.openFile(file);
		} catch (error) {
			const message = errorMessage(error);
			await panes.methods
				.update({
					workSessionId,
					paneId,
					metadata: {
						...withoutOpenState(this.#current(workSessionId, paneId).metadata),
						[NOTEBOOK_PANE_METADATA.openState]: "error",
						[NOTEBOOK_PANE_METADATA.openError]: message,
					},
				})
				.catch(() => undefined);
			throw error instanceof KernelError ? error : new KernelError("BUSINESS", message);
		}
		return panes.methods.update({
			workSessionId,
			paneId,
			title: opened.title,
			metadata: {
				...withoutOpenState(this.#current(workSessionId, paneId).metadata),
				[NOTEBOOK_PANE_METADATA.notebookPath]: opened.path,
				[NOTEBOOK_PANE_METADATA.notebookId]: opened.notebookId,
				[NOTEBOOK_PANE_METADATA.openState]: "ready",
			},
		});
	}
}
