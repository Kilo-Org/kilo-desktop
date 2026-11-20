import {
	applyHydratedStatus,
	applyKiloEvent,
	IDLE,
	resetActivity,
	sameInfo,
	type ChatActivity,
	type ChatInfo,
	type ChatRecord,
	type ChatRecords,
	type KiloEvent,
} from "./activity";

export interface PendingRequest {
	readonly id: string;
	readonly sessionID: string;
}

/** What the server said about activity on (re)connect; `complete` is false when a read failed. */
export interface ActivitySnapshot {
	readonly statuses?: {
		readonly byChat: Readonly<Record<string, { readonly type: string }>>;
		readonly complete: boolean;
	};
	readonly permissions?: {
		readonly requests: readonly PendingRequest[];
		readonly complete: boolean;
	};
	readonly questions?: { readonly requests: readonly PendingRequest[]; readonly complete: boolean };
	/** Where each chat's status or prompt was read. */
	readonly directories?: Readonly<Record<string, string>>;
}

type PendingKey = "pendingPermissionIds" | "pendingQuestionIds";

const isWorking = (activity: ChatActivity) =>
	activity.status === "busy" || activity.status === "retry";

const chatIdOf = (event: KiloEvent): string | undefined => {
	const id =
		event.properties.sessionID ?? (event.properties.info as { id?: unknown } | undefined)?.id;
	return typeof id === "string" ? id : undefined;
};

/**
 * Every chat the Kilo server has mentioned and its activity, as live events
 * and (re)connect reads merge into it. Ported from origin's activity store.
 *
 * Reads race the stream: each read is given the epoch taken before it was
 * sent, and anything live events changed since wins over it — a chat created,
 * deleted or renamed meanwhile, a turn that finished, a prompt answered (the
 * answered ids are remembered until a clean read). A read whose epoch is
 * current replaces what it covers; one that raced, or that could only reach
 * some directories, is merged instead.
 */
export class ConversationStore {
	#chats: ChatRecords = {};
	#epoch = 0;
	readonly #touched = new Map<string, number>();
	readonly #cleared: Record<PendingKey, Set<string>> = {
		pendingPermissionIds: new Set(),
		pendingQuestionIds: new Set(),
	};

	constructor(private readonly now: () => number) {}

	get chats(): ChatRecords {
		return this.#chats;
	}

	/** Bumps on every live change. */
	get epoch(): number {
		return this.#epoch;
	}

	apply(event: KiloEvent): boolean {
		const before = this.#chats;
		const after = applyKiloEvent(before, event, this.now());
		if (after === before) return false;
		const chatId = chatIdOf(event);
		this.#epoch += 1;
		if (chatId) {
			this.#touched.set(chatId, this.#epoch);
			for (const key of ["pendingPermissionIds", "pendingQuestionIds"] as const) {
				const was = before[chatId]?.activity[key] ?? [];
				const now = after[chatId]?.activity[key] ?? [];
				// Pending id lists hold a few entries; a Set would cost more.
				// react-doctor-disable-next-line react-doctor/js-set-map-lookups
				for (const id of was) if (!now.includes(id)) this.#cleared[key].add(id);
				for (const id of now) this.#cleared[key].delete(id);
			}
		}
		this.#chats = after;
		return true;
	}

	/**
	 * The server's full list of root chats: newer info wins, and roots it no
	 * longer lists go with their subagents.
	 */
	replaceRoots(infos: readonly ChatInfo[], sinceEpoch: number): void {
		const changedSince = (id: string) => (this.#touched.get(id) ?? 0) > sinceEpoch;
		const listed = new Set(infos.map((info) => info.id));
		const gone = new Set(
			Object.entries(this.#chats)
				.filter(
					([id, record]) => record.info?.parentId === null && !listed.has(id) && !changedSince(id),
				)
				.map(([id]) => id),
		);
		let next: Record<string, ChatRecord> = { ...this.#chats };
		for (let found = gone.size > 0; found;) {
			found = false;
			for (const [id, record] of Object.entries(next)) {
				const parentId = record.info?.parentId;
				if (!gone.has(id) && parentId && gone.has(parentId)) {
					gone.add(id);
					found = true;
				}
			}
		}
		for (const id of gone) delete next[id];
		next = this.#withInfos(
			next,
			infos.filter((info) => !(changedSince(info.id) && !next[info.id])),
		);
		this.#chats = next;
	}

	/** Chats looked up one by one (subagent lineage, a chat just created). */
	addInfos(infos: readonly ChatInfo[]): void {
		this.#chats = this.#withInfos({ ...this.#chats }, infos);
	}

	hydrateActivity(snapshot: ActivitySnapshot, sinceEpoch: number): void {
		const raced = this.#epoch !== sinceEpoch;
		if (!raced) {
			this.#cleared.pendingPermissionIds.clear();
			this.#cleared.pendingQuestionIds.clear();
		}
		let next: Record<string, ChatRecord> = { ...this.#chats };
		if (snapshot.permissions) {
			next = this.#withPending(next, "pendingPermissionIds", snapshot.permissions, raced);
		}
		if (snapshot.questions) {
			next = this.#withPending(next, "pendingQuestionIds", snapshot.questions, raced);
		}
		if (snapshot.statuses) next = this.#withStatuses(next, snapshot.statuses, raced);
		for (const [id, directory] of Object.entries(snapshot.directories ?? {})) {
			const record = next[id];
			if (record && record.directory !== directory) next[id] = { ...record, directory };
		}
		this.#chats = next;
	}

	resetActivity(): void {
		this.#chats = resetActivity(this.#chats);
	}

	#withInfos(next: Record<string, ChatRecord>, infos: readonly ChatInfo[]) {
		for (const info of infos) {
			const record = next[info.id];
			if (record?.info && (record.info.updatedAt > info.updatedAt || sameInfo(record.info, info))) {
				continue;
			}
			next[info.id] = { ...(record ?? { activity: IDLE }), info };
		}
		return next;
	}

	#withPending(
		next: Record<string, ChatRecord>,
		key: PendingKey,
		read: NonNullable<ActivitySnapshot["permissions"]>,
		raced: boolean,
	) {
		const byChat = new Map<string, string[]>();
		for (const request of read.requests) {
			byChat.set(request.sessionID, [...(byChat.get(request.sessionID) ?? []), request.id]);
		}
		const replace = read.complete && !raced;
		const chatIds = new Set(byChat.keys());
		for (const [id, record] of Object.entries(next)) {
			if (record.activity[key].length > 0) chatIds.add(id);
		}
		for (const chatId of chatIds) {
			const record = next[chatId] ?? { activity: IDLE };
			const snapshot = byChat.get(chatId) ?? [];
			const pending = replace
				? snapshot
				: [
						...new Set([
							...record.activity[key],
							...snapshot.filter((id) => !this.#cleared[key].has(id)),
						]),
					];
			const current = record.activity[key];
			if (pending.length === current.length && pending.every((id, i) => id === current[i]))
				continue;
			next[chatId] = { ...record, activity: { ...record.activity, [key]: pending } };
		}
		return next;
	}

	#withStatuses(
		next: Record<string, ChatRecord>,
		read: NonNullable<ActivitySnapshot["statuses"]>,
		raced: boolean,
	) {
		const now = this.now();
		const apply = (chatId: string, type: string) => {
			const activity = applyHydratedStatus(next[chatId]?.activity, type, now, {
				skipBusyIfCompleted: raced,
			});
			if (activity) next[chatId] = { ...(next[chatId] ?? {}), activity };
		};
		for (const [chatId, status] of Object.entries(read.byChat)) apply(chatId, status.type);
		if (read.complete && !raced) {
			for (const [chatId, record] of Object.entries(next)) {
				if (isWorking(record.activity) && !(chatId in read.byChat)) apply(chatId, "idle");
			}
		}
		return next;
	}
}
