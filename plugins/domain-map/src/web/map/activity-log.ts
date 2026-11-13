import type { Activity } from "./activity";

export interface ActivityEntry {
	readonly id: number;
	readonly at: number;
	readonly domainId: string;
	readonly kind: Activity["kind"];
	/** The event's name, or `state` for a state change. */
	readonly name: string;
	/** How many plugins declare they use the domain object (in `requires`). */
	readonly users: number;
	/** The event's payload as short JSON; empty for state changes. */
	readonly payload: string;
}

export interface ActivityLogOptions {
	readonly limit?: number;
	readonly payloadLength?: number;
	readonly now?: () => number;
}

function preview(payload: unknown, length: number): string {
	let text: string | undefined;
	try {
		text = JSON.stringify(payload);
	} catch {
		return "[unprintable]";
	}
	if (text === undefined) return "";
	return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** What domain objects did lately, newest first, for the map's live log. */
export class ActivityLog {
	readonly #limit: number;
	readonly #payloadLength: number;
	readonly #now: () => number;
	#entries: ActivityEntry[] = [];
	#nextId = 1;

	constructor({ limit = 200, payloadLength = 160, now = Date.now }: ActivityLogOptions = {}) {
		this.#limit = limit;
		this.#payloadLength = payloadLength;
		this.#now = now;
	}

	add(activity: Activity, users: number): void {
		const entry: ActivityEntry = {
			id: this.#nextId++,
			at: this.#now(),
			domainId: activity.domainId,
			kind: activity.kind,
			name: activity.kind === "event" ? activity.event : "state",
			users,
			payload: activity.kind === "event" ? preview(activity.payload, this.#payloadLength) : "",
		};
		this.#entries = [entry, ...this.#entries].slice(0, this.#limit);
	}

	entries(): readonly ActivityEntry[] {
		return this.#entries;
	}

	clear(): void {
		this.#entries = [];
	}
}
