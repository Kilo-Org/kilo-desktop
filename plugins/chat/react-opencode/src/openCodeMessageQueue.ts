import type { AppendMessage, ExternalThreadQueueAdapter } from "@assistant-ui/react";

export type OpenCodeMessageQueueOptions = {
	cancelBehavior: "clear" | "pause";
	/**
	 * Opts into user queue controls (pause/resume, reorder, inline edit) backed
	 * by one visible paused state. Off keeps the legacy semantics: Stop parks
	 * the waiting entries and a failed send pauses until an entry is steered.
	 */
	userControls?: boolean | undefined;
};

/**
 * Resolving with "returned-to-composer" means the send failed but the driver
 * already handed the message back to the user, so the queue drops it instead
 * of pausing on it. Resolving with nothing means the message was accepted.
 */
export type OpenCodeMessageQueueSendOutcome = void | "returned-to-composer";

export type OpenCodeMessageQueueDriver = {
	send(message: AppendMessage): Promise<OpenCodeMessageQueueSendOutcome>;
	cancel(): Promise<void>;
};

export type OpenCodeMessageQueueControlsState = {
	/** No queued message sends on its own; explicit steering still works. */
	readonly paused: boolean;
	/** The message held back for an inline edit, if any. */
	readonly editingId: string | undefined;
};

export type OpenCodeMessageQueueActions = {
	pause(): void;
	resume(): void;
	/** Reorders waiting messages; unknown ids are ignored. */
	reorder(orderedIds: readonly string[]): void;
	/**
	 * Holds draining for an edit and returns its draft: the message's raw text
	 * for a new edit, or the saved draft when the same edit is reopened.
	 */
	beginEdit(id: string): string | undefined;
	/** Keeps the open edit's draft so it survives the editor unmounting. */
	setEditDraft(text: string): void;
	/** The open edit's draft, if an edit is open. */
	getEditDraft(): string | undefined;
	/** Replaces the text parts in place; false when the result would be empty. */
	commitEdit(id: string, text: string): boolean;
	cancelEdit(): void;
};

/** Queue state and actions published to the UI through thread extras. */
export type OpenCodeMessageQueueControls = OpenCodeMessageQueueControlsState &
	OpenCodeMessageQueueActions;

export type OpenCodeMessageQueueController = OpenCodeMessageQueueActions & {
	readonly adapter: ExternalThreadQueueAdapter;
	readonly subscribe: (listener: () => void) => () => void;
	readonly getSnapshot: () => number;
	getControlsState(): OpenCodeMessageQueueControlsState;
	/** Applies options to a live queue, e.g. when a feature flag flips. */
	setOptions(options: OpenCodeMessageQueueOptions): void;
	setDriver(driver: OpenCodeMessageQueueDriver): void;
	setRunning(running: boolean, snapshot?: object): void;
};
