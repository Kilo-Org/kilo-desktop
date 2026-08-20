import type { KvStore, MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

interface PersistedCleanup extends Record<string, unknown> {
	pendingWorkspaceIds: string[];
}

const DEFAULTS: PersistedCleanup = { pendingWorkspaceIds: [] };
const NAMESPACE = "workspace-session-cleanup";

/**
 * Owns durable, serialized cleanup of workspace stamps on Kilo sessions.
 * Workspace deletion remains successful when Kilo is temporarily unavailable,
 * while pending ids survive plugin restarts until cleanup succeeds. Enqueue
 * schedules cleanup in the background so network work never blocks deletion.
 */
export class WorkspaceSessionCleanupQueue {
	readonly #store: KvStore<PersistedCleanup>;
	readonly #cleanup: (workspaceId: string) => Promise<void>;
	readonly #sdk: MainSdk;
	readonly #scheduled = new Map<string, Promise<void>>();
	#tail = Promise.resolve();

	constructor(sdk: MainSdk, cleanup: (workspaceId: string) => Promise<void>) {
		this.#sdk = sdk;
		this.#cleanup = cleanup;
		this.#store = sdk.storage.kv<PersistedCleanup>({
			namespace: NAMESPACE,
			defaults: DEFAULTS,
		});
	}

	retryPending(): void {
		for (const workspaceId of this.#pending()) {
			void this.#schedule(workspaceId);
		}
	}

	enqueue(workspaceId: string): void {
		const pending = this.#pending();
		if (!pending.includes(workspaceId)) {
			try {
				this.#store.set({ pendingWorkspaceIds: [...pending, workspaceId] });
			} catch (error) {
				this.#sdk.logger.warn("Could not persist pending workspace chat cleanup.", {
					error: error instanceof Error ? error.message : String(error),
					workspaceId,
				});
			}
		}
		void this.#schedule(workspaceId);
	}

	#pending(): string[] {
		const value = this.#store.get("pendingWorkspaceIds");
		if (!Array.isArray(value)) return [];
		return value.filter(
			(entry, index): entry is string =>
				typeof entry === "string" && entry.length > 0 && value.indexOf(entry) === index,
		);
	}

	#schedule(workspaceId: string): Promise<void> {
		const existing = this.#scheduled.get(workspaceId);
		if (existing) return existing;

		const run = this.#tail.then(async () => {
			try {
				await this.#cleanup(workspaceId);
				this.#store.set({
					pendingWorkspaceIds: this.#pending().filter((entry) => entry !== workspaceId),
				});
			} catch (error) {
				this.#sdk.logger.warn("Could not clear workspace from chats after deleting a workspace.", {
					error: error instanceof Error ? error.message : String(error),
					workspaceId,
				});
			}
		});
		this.#scheduled.set(workspaceId, run);
		this.#tail = run;
		void run.finally(() => this.#scheduled.delete(workspaceId));
		return run;
	}
}
