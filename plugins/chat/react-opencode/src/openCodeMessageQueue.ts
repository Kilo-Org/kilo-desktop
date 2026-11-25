import type {
	AppendMessage,
	ExternalThreadQueueAdapter,
	QueueItemState,
} from "@assistant-ui/react";

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

type QueueEntry = {
	readonly state: OpenCodeQueueItemState;
	readonly message: AppendMessage;
	readonly immediateFollowup: boolean;
	readonly visible: boolean;
	/** Legacy Stop hold (no user controls): sends only when explicitly steered. */
	readonly parked: boolean;
};

// Written against an older @assistant-ui/core queue API (items without
// `parts`, `enqueue(message, { steer })`, `steer(id)`, `clear`); kilo.chat
// supplies its own queue (`messageQueue.create`), so this built-in one is
// kept as forked, typed to the API it was written for.
type OpenCodeQueueItemState = Omit<QueueItemState, "parts"> & {
	readonly attachmentPreview?: {
		readonly name: string;
		readonly src?: string;
	};
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

const messageText = (message: AppendMessage) =>
	message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

const queuePreview = (message: AppendMessage) => {
	const text = messageText(message).trim();
	if (text) return text;
	if ((message.attachments?.length ?? 0) > 0) return "Attachment";
	return "Message";
};

const queueAttachmentPreview = (
	message: AppendMessage,
): OpenCodeQueueItemState["attachmentPreview"] => {
	const attachment = message.attachments?.[0];
	if (!attachment) return undefined;

	const image = attachment.content?.find((part) => part.type === "image");
	return {
		name: attachment.name,
		...(image ? { src: image.image } : {}),
	};
};

const messageForImmediateFollowup = (message: AppendMessage): AppendMessage => ({
	...message,
	startRun: true,
});

const withEditedText = (message: AppendMessage, text: string): AppendMessage | undefined => {
	const trimmed = text.trim();
	const otherParts = message.content.filter((part) => part.type !== "text");
	const hasAttachments = (message.attachments?.length ?? 0) > 0;
	if (!trimmed && otherParts.length === 0 && !hasAttachments) return undefined;
	return {
		...message,
		content: (trimmed
			? [{ type: "text", text: trimmed }, ...otherParts]
			: otherParts) as AppendMessage["content"],
	};
};

/**
 * Owns one thread's client-side prompt queue. Messages remain in the queue
 * until OpenCode accepts them, while backend run state gates FIFO draining.
 * A dispatch from idle must observe its run start before another idle snapshot
 * can advance the queue. Backend snapshot identity distinguishes a completed
 * run from stale idle effects replayed after an optimistic run start.
 * Cancellation is deliberately separated from steering so a failed abort can
 * leave the selected item in place and pause the queue without losing drafts.
 *
 * A rejected send or abort sets `paused` so nothing retries without intent,
 * and keeps the entry for an explicit retry, unless the driver reports it
 * "returned-to-composer": then the user already holds the message, so the
 * entry is dropped. The pause clears itself once the queue empties so it
 * never swallows a later send.
 *
 * Two modes, switchable live via setOptions:
 * - Legacy (no `userControls`): the pause is invisible and steering clears
 *   it. Stop (cancel-run with cancelBehavior "pause") parks every waiting
 *   entry: parked entries only send when steered, while messages queued after
 *   Stop keep draining.
 * - `userControls`: one visible `paused` flag holds every waiting entry. The
 *   user toggles it, and Stop sets it when entries are waiting. Steering a
 *   paused entry leaves the queue paused, and a message sent while the agent
 *   is idle still dispatches right away. An inline edit holds automatic
 *   draining (tool-blocking follow-ups still go) and pins its entry so it
 *   cannot be steered mid-edit. The edit and its draft live here, not in the
 *   editor, so leaving the editor keeps the hold and the draft; only saving
 *   or cancelling releases it, and draining resumes at once. Reordering only
 *   moves visible entries; in-flight and follow-up entries keep their slots.
 * Switching modes maps parked entries onto the visible pause and back, and an
 * open edit onto parking, so a flag flip never releases messages the user held.
 */
export const createOpenCodeMessageQueue = (
	options: OpenCodeMessageQueueOptions,
): OpenCodeMessageQueueController => {
	let entries: readonly QueueEntry[] = [];
	let driver: OpenCodeMessageQueueDriver | undefined;
	let running = false;
	let awaitingRunStart = false;
	let observedSnapshot: object | undefined;
	const ignoredIdleSnapshots = new Set<object>();
	let cancelBehavior = options.cancelBehavior;
	let userControls = options.userControls ?? false;
	let paused = false;
	let editingId: string | undefined;
	let editDraft: string | undefined;
	let operation: "idle" | "sending" | "cancelling" = "idle";
	let activeId: string | undefined;
	let pendingSteerId: string | undefined;
	let version = 0;
	let nextId = 0;
	let controlsState: OpenCodeMessageQueueControlsState = {
		paused,
		editingId,
	};
	const listeners = new Set<() => void>();

	const notify = () => {
		if (entries.length === 0) paused = false;
		version += 1;
		adapter.items = entries.filter((entry) => entry.visible).map((entry) => entry.state);
		if (controlsState.paused !== paused || controlsState.editingId !== editingId) {
			controlsState = { paused, editingId };
		}
		for (const listener of listeners) listener();
	};

	const removeEntry = (id: string) => {
		entries = entries.filter((entry) => entry.state.id !== id);
		notify();
	};

	const dispatch = (id: string) => {
		if (!driver || operation !== "idle") return;
		const entry = entries.find((candidate) => candidate.state.id === id);
		if (!entry) return;

		const startsNewRun = !running;
		operation = "sending";
		activeId = id;
		if (startsNewRun) {
			awaitingRunStart = true;
			ignoredIdleSnapshots.clear();
			if (observedSnapshot) ignoredIdleSnapshots.add(observedSnapshot);
		}
		running = true;
		if (entry.visible) {
			entries = entries.map((candidate) =>
				candidate.state.id === id ? { ...candidate, visible: false } : candidate,
			);
			notify();
		}
		const message = entry.immediateFollowup
			? messageForImmediateFollowup(entry.message)
			: entry.message;

		const releaseUnstartedRun = () => {
			if (startsNewRun && awaitingRunStart) {
				awaitingRunStart = false;
				running = false;
				ignoredIdleSnapshots.clear();
			}
		};

		void driver.send(message).then(
			(outcome) => {
				removeEntry(id);
				operation = "idle";
				activeId = undefined;
				if (outcome === "returned-to-composer") releaseUnstartedRun();
				advance();
			},
			() => {
				operation = "idle";
				activeId = undefined;
				releaseUnstartedRun();
				paused = true;
				entries = entries.map((entry) =>
					entry.state.id === id ? { ...entry, visible: true } : entry,
				);
				notify();
				advance();
			},
		);
	};

	const advance = () => {
		if (operation !== "idle") return;
		const immediateFollowup = entries.find((entry) => entry.immediateFollowup);
		if (immediateFollowup) {
			dispatch(immediateFollowup.state.id);
			return;
		}
		if (paused || running || editingId !== undefined) return;
		const head = entries.find((entry) => !entry.parked);
		if (head) dispatch(head.state.id);
	};

	const steer = (id: string) => {
		if (!driver || operation !== "idle") return;
		if (id === editingId) return;
		if (!entries.some((entry) => entry.state.id === id)) return;

		// Only the legacy pause is an invisible retry hold that steering releases.
		if (!userControls) paused = false;
		pendingSteerId = id;
		if (!running) {
			pendingSteerId = undefined;
			dispatch(id);
			return;
		}

		operation = "cancelling";
		activeId = id;
		void driver.cancel().then(
			() => {
				operation = "idle";
				activeId = undefined;
				if (!running && pendingSteerId === id) {
					pendingSteerId = undefined;
					dispatch(id);
					return;
				}
				advance();
			},
			() => {
				operation = "idle";
				activeId = undefined;
				pendingSteerId = undefined;
				paused = true;
				notify();
				advance();
			},
		);
	};

	const adapter = {
		items: [] as readonly OpenCodeQueueItemState[],
		enqueue: (message: AppendMessage, { steer: steerImmediately }: { steer?: boolean }) => {
			const id = `opencode-queue:${nextId++}`;
			const attachmentPreview = queueAttachmentPreview(message);
			const immediateFollowup = message.startRun === false;
			// With user controls an idle agent takes a new message right away, even
			// with the queue paused: the pause holds entries that were already waiting.
			const sendsFromIdle =
				!immediateFollowup &&
				!steerImmediately &&
				!running &&
				operation === "idle" &&
				(userControls || !paused);
			const dispatchImmediately =
				driver !== undefined &&
				((immediateFollowup && operation === "idle") || steerImmediately || sendsFromIdle);
			entries = [
				...entries,
				{
					state: {
						id,
						prompt: queuePreview(message),
						...(attachmentPreview ? { attachmentPreview } : {}),
					},
					message,
					immediateFollowup,
					visible: !dispatchImmediately,
					parked: false,
				},
			];
			if (!dispatchImmediately) notify();

			// startRun=false is reserved by the Kilo composer for a tool-blocking
			// follow-up. It bypasses the client queue without aborting the current
			// server turn, matching the pre-queue OpenCode behavior.
			if (immediateFollowup) {
				dispatch(id);
			} else if (steerImmediately) {
				steer(id);
			} else if (dispatchImmediately) {
				dispatch(id);
			} else {
				advance();
			}
		},
		steer,
		remove: (id: string) => {
			if (id === activeId || id === pendingSteerId) return;
			entries = entries.filter((entry) => entry.state.id !== id);
			if (id === editingId) closeEdit();
			notify();
			advance();
		},
		clear: (reason?: string) => {
			if (reason === "cancel-run" && cancelBehavior === "pause") {
				if (!userControls) {
					entries = entries.map((entry) =>
						entry.immediateFollowup ? entry : { ...entry, parked: true },
					);
				} else if (entries.some((entry) => entry.visible && !entry.immediateFollowup)) {
					paused = true;
				}
				notify();
				return;
			}
			entries = [];
			pendingSteerId = undefined;
			closeEdit();
			paused = false;
			notify();
		},
	};

	function closeEdit() {
		editingId = undefined;
		editDraft = undefined;
	}

	const findWaiting = (id: string) =>
		entries.find((entry) => entry.visible && entry.state.id === id);

	return {
		adapter: adapter as unknown as ExternalThreadQueueAdapter,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: () => version,
		getControlsState: () => controlsState,
		setOptions: (nextOptions) => {
			cancelBehavior = nextOptions.cancelBehavior;
			const nextUserControls = nextOptions.userControls ?? false;
			if (nextUserControls === userControls) return;
			userControls = nextUserControls;
			if (userControls) {
				if (entries.some((entry) => entry.parked)) paused = true;
				entries = entries.map((entry) => (entry.parked ? { ...entry, parked: false } : entry));
			} else {
				// Without Resume or an editor, a held queue degrades to legacy parking.
				if (paused || editingId !== undefined) {
					entries = entries.map((entry) =>
						entry.visible && !entry.immediateFollowup ? { ...entry, parked: true } : entry,
					);
				}
				paused = false;
				closeEdit();
			}
			notify();
			advance();
		},
		pause: () => {
			if (paused) return;
			paused = true;
			notify();
		},
		resume: () => {
			if (!paused) return;
			paused = false;
			notify();
			advance();
		},
		reorder: (orderedIds) => {
			const waiting = entries.filter((entry) => entry.visible);
			const unlisted = new Map(waiting.map((entry) => [entry.state.id, entry]));
			const listed: QueueEntry[] = [];
			for (const id of orderedIds) {
				const entry = unlisted.get(id);
				if (!entry) continue;
				listed.push(entry);
				unlisted.delete(id);
			}
			const sorted = [...listed, ...unlisted.values()];
			if (sorted.every((entry, index) => entry === waiting[index])) return;
			let slot = 0;
			entries = entries.map((entry) => (entry.visible ? sorted[slot++]! : entry));
			notify();
		},
		beginEdit: (id) => {
			if (id === editingId) return editDraft;
			if (id === activeId || id === pendingSteerId) return undefined;
			const entry = findWaiting(id);
			if (!entry) return undefined;
			editingId = id;
			editDraft = messageText(entry.message);
			notify();
			return editDraft;
		},
		setEditDraft: (text) => {
			if (editingId !== undefined) editDraft = text;
		},
		getEditDraft: () => editDraft,
		commitEdit: (id, text) => {
			if (id !== editingId) return false;
			const entry = findWaiting(id);
			const message = entry && withEditedText(entry.message, text);
			if (!message) return false;
			entries = entries.map((candidate) =>
				candidate.state.id === id
					? {
							...candidate,
							message,
							state: { ...candidate.state, prompt: queuePreview(message) },
						}
					: candidate,
			);
			closeEdit();
			notify();
			advance();
			return true;
		},
		cancelEdit: () => {
			if (editingId === undefined) return;
			closeEdit();
			notify();
			advance();
		},
		setDriver: (nextDriver) => {
			driver = nextDriver;
		},
		setRunning: (nextRunning, snapshot) => {
			observedSnapshot = snapshot;
			if (nextRunning) {
				running = true;
				if (awaitingRunStart && snapshot && ignoredIdleSnapshots.has(snapshot)) {
					return;
				}
				awaitingRunStart = false;
				return;
			}
			if (awaitingRunStart) {
				if (snapshot) ignoredIdleSnapshots.add(snapshot);
				return;
			}
			if (snapshot && ignoredIdleSnapshots.has(snapshot)) return;
			ignoredIdleSnapshots.clear();
			running = false;
			if (operation === "cancelling") return;
			if (pendingSteerId) {
				const id = pendingSteerId;
				pendingSteerId = undefined;
				dispatch(id);
				return;
			}
			advance();
		},
	};
};
