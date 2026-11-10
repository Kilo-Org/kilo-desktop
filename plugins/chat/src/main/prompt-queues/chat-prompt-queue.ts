import {
	queuePreview,
	type ChatQueue,
	type PreparedText,
	type QueuedPrompt,
} from "../../contracts";

/** How long a sent prompt may take to start its turn before the queue stops waiting for it. */
export const RUN_START_TIMEOUT_MS = 15_000;

interface Entry {
	readonly id: string;
	readonly prompt: QueuedPrompt;
	/** Listed as waiting; false while it is being sent. */
	readonly visible: boolean;
	/** Held by Stop (without queue editing): sent only by Send now. */
	readonly parked: boolean;
}

/** What a chat's queue needs from the rest of main. */
export interface QueueHost {
	readonly send: (prompt: QueuedPrompt) => Promise<void>;
	readonly abort: () => Promise<void>;
	readonly queueEditing: () => boolean;
	readonly changed: () => void;
}

/**
 * One chat's queue: origin's react-opencode client queue, moved to main. It
 * sends when the chat is known to be idle, one prompt per turn.
 *
 * - `working` is kilo.core's status for the chat; null while unknown (not
 *   ready, or the chat isn't listed), which holds the queue like a turn does.
 *   kilo.core's turn events report a turn the status may not have shown yet.
 * - A prompt sent from idle starts a turn the status hasn't shown yet, so
 *   `awaitingStart` ignores idle reports until the chat is seen working
 *   (or `RUN_START_TIMEOUT_MS` passes): a stale idle must not send the next.
 * - Send now (`steer`) stops the turn and sends its prompt once the chat is
 *   idle, ahead of the rest. A refused send or stop pauses the queue, so
 *   nothing retries without the person.
 * - With queue editing, one visible `paused` holds everything and Stop sets
 *   it. Without, Stop parks what waited (later prompts still go) and the
 *   pause is internal, cleared by Send now. Switching maps one onto the other.
 * - An open edit holds automatic sending and pins its prompt.
 */
export class ChatPromptQueue {
	#entries: Entry[] = [];
	#paused = false;
	#editing: { id: string; draft: string } | null = null;
	#operation: "idle" | "sending" | "cancelling" = "idle";
	#activeId: string | undefined;
	#pendingSteerId: string | undefined;
	#working: boolean | null = null;
	#awaitingStart = false;
	#startTimer: ReturnType<typeof setTimeout> | undefined;
	#queueEditing: boolean;

	constructor(
		private readonly host: QueueHost,
		private readonly nextId: () => string,
	) {
		this.#queueEditing = host.queueEditing();
	}

	/** Nothing to keep: a queue made again later reads the chat's status afresh. */
	get empty(): boolean {
		// While a sent prompt's turn hasn't shown, a fresh queue would take the
		// stale idle status for real and send the next prompt into that turn.
		return this.#entries.length === 0 && this.#operation === "idle" && !this.#awaitingStart;
	}

	view(): ChatQueue | null {
		const items = this.#entries
			.filter((entry) => entry.visible)
			.map(({ id, prompt }) => ({
				id,
				prompt: queuePreview(prompt),
				text: prompt.text,
				...(prompt.attachmentPreview ? { attachmentPreview: prompt.attachmentPreview } : {}),
			}));
		const paused = this.#queueEditing && this.#paused;
		const sending = this.#operation === "sending" || this.#awaitingStart;
		if (items.length === 0 && !paused && !this.#editing && !sending) return null;
		return { items, paused, editing: this.#editing, sending };
	}

	enqueue(prompt: QueuedPrompt, options: { steer?: boolean; failed?: boolean }): string {
		const id = this.nextId();
		const sendsFromIdle =
			!options.steer &&
			!options.failed &&
			this.#idle() &&
			this.#operation === "idle" &&
			(this.#queueEditing || !this.#paused);
		this.#entries = [...this.#entries, { id, prompt, visible: true, parked: false }];
		if (options.failed) this.#paused = true;
		this.#notify();
		if (options.steer) this.steer(id);
		else if (sendsFromIdle) this.#dispatch(id);
		else this.#advance();
		return id;
	}

	steer(id: string): void {
		if (this.#operation !== "idle" || id === this.#editing?.id) return;
		if (!this.#entries.some((entry) => entry.id === id)) return;
		if (!this.#queueEditing) this.#paused = false;
		if (this.#idle()) {
			this.#dispatch(id);
			return;
		}
		this.#pendingSteerId = id;
		this.#operation = "cancelling";
		this.#activeId = id;
		this.host.abort().then(
			() => {
				this.#operation = "idle";
				this.#activeId = undefined;
				if (this.#idle() && this.#pendingSteerId === id) {
					this.#pendingSteerId = undefined;
					this.#dispatch(id);
					return;
				}
				this.#advance();
			},
			() => {
				this.#operation = "idle";
				this.#activeId = undefined;
				this.#pendingSteerId = undefined;
				this.#paused = true;
				this.#notify();
				this.#advance();
			},
		);
	}

	remove(id: string): void {
		if (id === this.#activeId || id === this.#pendingSteerId) return;
		this.#entries = this.#entries.filter((entry) => entry.id !== id);
		if (id === this.#editing?.id) this.#editing = null;
		this.#notify();
		this.#advance();
	}

	stopped(): void {
		if (!this.#queueEditing) {
			this.#entries = this.#entries.map((entry) => ({ ...entry, parked: true }));
		} else if (this.#entries.some((entry) => entry.visible)) {
			this.#paused = true;
		}
		this.#notify();
	}

	clear(): void {
		this.#entries = [];
		this.#pendingSteerId = undefined;
		this.#editing = null;
		this.#paused = false;
		this.#notify();
	}

	pause(): void {
		if (this.#paused) return;
		this.#paused = true;
		this.#notify();
	}

	resume(): void {
		if (!this.#paused) return;
		this.#paused = false;
		this.#notify();
		this.#advance();
	}

	reorder(ids: readonly string[]): void {
		const waiting = this.#entries.filter((entry) => entry.visible);
		const unlisted = new Map(waiting.map((entry) => [entry.id, entry]));
		const listed: Entry[] = [];
		for (const id of ids) {
			const entry = unlisted.get(id);
			if (!entry) continue;
			listed.push(entry);
			unlisted.delete(id);
		}
		const sorted = [...listed, ...unlisted.values()];
		if (sorted.every((entry, index) => entry === waiting[index])) return;
		let slot = 0;
		this.#entries = this.#entries.map((entry) => (entry.visible ? sorted[slot++]! : entry));
		this.#notify();
	}

	beginEdit(id: string): string | null {
		if (id === this.#editing?.id) return this.#editing.draft;
		if (id === this.#activeId || id === this.#pendingSteerId) return null;
		const entry = this.#waiting(id);
		if (!entry) return null;
		this.#editing = { id, draft: entry.prompt.text };
		this.#notify();
		return entry.prompt.text;
	}

	setEditDraft(text: string): void {
		if (!this.#editing || this.#editing.draft === text) return;
		this.#editing = { ...this.#editing, draft: text };
		this.#notify();
	}

	commitEdit(id: string, text: PreparedText): boolean {
		if (id !== this.#editing?.id) return false;
		const entry = this.#waiting(id);
		if (!entry) return false;
		const prompt: QueuedPrompt = { ...entry.prompt, ...text };
		if (!prompt.text.trim() && prompt.attachmentParts.length === 0) return false;
		this.#entries = this.#entries.map((candidate) =>
			candidate.id === id ? { ...candidate, prompt } : candidate,
		);
		this.#editing = null;
		this.#notify();
		this.#advance();
		return true;
	}

	cancelEdit(): void {
		if (!this.#editing) return;
		this.#editing = null;
		this.#notify();
		this.#advance();
	}

	setQueueEditing(queueEditing: boolean): void {
		if (queueEditing === this.#queueEditing) return;
		this.#queueEditing = queueEditing;
		if (queueEditing) {
			if (this.#entries.some((entry) => entry.parked)) this.#paused = true;
			this.#entries = this.#entries.map((entry) => ({ ...entry, parked: false }));
		} else {
			if (this.#paused || this.#editing) {
				this.#entries = this.#entries.map((entry) =>
					entry.visible ? { ...entry, parked: true } : entry,
				);
			}
			this.#paused = false;
			this.#editing = null;
		}
		this.#notify();
		this.#advance();
	}

	/** kilo.core's status for the chat; null while unknown. */
	setWorking(working: boolean | null): void {
		if (working === this.#working) return;
		this.#working = working;
		if (working !== false) {
			if (working && this.#awaitingStart) {
				this.#stopAwaitingStart();
				this.#notify();
			}
			return;
		}
		if (this.#awaitingStart || this.#operation === "cancelling") return;
		const steered = this.#pendingSteerId;
		if (steered && this.#operation === "idle") {
			this.#pendingSteerId = undefined;
			this.#dispatch(steered);
			return;
		}
		this.#advance();
	}

	dispose(): void {
		clearTimeout(this.#startTimer);
	}

	#idle(): boolean {
		return this.#working === false && !this.#awaitingStart;
	}

	#waiting(id: string): Entry | undefined {
		return this.#entries.find((entry) => entry.visible && entry.id === id);
	}

	#advance(): void {
		if (this.#operation !== "idle" || !this.#idle()) return;
		if (this.#paused || this.#editing) return;
		const head = this.#entries.find((entry) => !entry.parked);
		if (head) this.#dispatch(head.id);
	}

	#dispatch(id: string): void {
		const entry = this.#entries.find((candidate) => candidate.id === id);
		if (!entry || this.#operation !== "idle") return;
		this.#operation = "sending";
		this.#activeId = id;
		this.#awaitingStart = true;
		clearTimeout(this.#startTimer);
		this.#startTimer = setTimeout(() => {
			this.#stopAwaitingStart();
			this.#notify();
			this.#advance();
		}, RUN_START_TIMEOUT_MS);
		this.#entries = this.#entries.map((candidate) =>
			candidate.id === id ? { ...candidate, visible: false } : candidate,
		);
		this.#notify();
		this.host.send(entry.prompt).then(
			() => {
				this.#entries = this.#entries.filter((candidate) => candidate.id !== id);
				this.#operation = "idle";
				this.#activeId = undefined;
				this.#notify();
				this.#advance();
			},
			() => {
				this.#operation = "idle";
				this.#activeId = undefined;
				this.#stopAwaitingStart();
				this.#paused = true;
				this.#entries = this.#entries.map((candidate) =>
					candidate.id === id ? { ...candidate, visible: true } : candidate,
				);
				this.#notify();
			},
		);
	}

	#stopAwaitingStart(): void {
		this.#awaitingStart = false;
		clearTimeout(this.#startTimer);
		this.#startTimer = undefined;
	}

	#notify(): void {
		if (this.#entries.length === 0) this.#paused = false;
		this.host.changed();
	}
}
