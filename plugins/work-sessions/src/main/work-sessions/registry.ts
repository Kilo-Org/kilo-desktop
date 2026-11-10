import { KernelError, type DomainObjectProvider, type KvStore } from "@kilo-desktop/kernel";

import type { WorkSession, WorkSessions } from "../../contracts/model";
import type { PersistedWorkSessions } from "../storage/stores";

/**
 * The work sessions as one persisted list, mirrored into the
 * `kilo.work-sessions/work-sessions` domain object. Every write goes through
 * here, so the kv value, the domain object's state and its events never
 * disagree: a change is saved, published, then announced.
 */
export class WorkSessionRegistry {
	readonly #store: KvStore<PersistedWorkSessions>;
	readonly #provider: DomainObjectProvider<typeof WorkSessions>;

	constructor(
		store: KvStore<PersistedWorkSessions>,
		provider: DomainObjectProvider<typeof WorkSessions>,
	) {
		this.#store = store;
		this.#provider = provider;
	}

	list(): WorkSession[] {
		return this.#store.snapshot().workSessions;
	}

	find(id: string): WorkSession | undefined {
		return this.list().find((workSession) => workSession.id === id);
	}

	holding(chatId: string): WorkSession | undefined {
		return this.list().find((workSession) => workSession.chatIds.includes(chatId));
	}

	persisted(): PersistedWorkSessions {
		return this.#store.snapshot();
	}

	save(next: WorkSession[], patch: Partial<PersistedWorkSessions> = {}): void {
		this.#store.set({ ...patch, workSessions: next });
		this.#provider.setState({ workSessions: next });
	}

	add(workSession: WorkSession): void {
		this.save([...this.list(), workSession]);
		this.#provider.emit("created", { workSession });
	}

	change(id: string, patch: Partial<WorkSession>): WorkSession {
		const before = this.find(id);
		if (!before) throw new KernelError("NOT_FOUND", "Session not found.");
		const after = { ...before, ...patch };
		this.save(this.list().map((workSession) => (workSession.id === id ? after : workSession)));
		this.#provider.emit("updated", { before, after });
		return after;
	}

	delete(workSession: WorkSession): void {
		this.save(this.list().filter((candidate) => candidate.id !== workSession.id));
		this.announceDeleted(workSession);
	}

	announceDeleted(workSession: WorkSession): void {
		this.#provider.emit("deleted", { workSession });
	}
}
