/**
 * "Trust new notebooks": approves dependencies of notebooks this app created,
 * so nteract's "needs approval before the kernel can start" prompt is skipped.
 *
 * nteract's UI approves trust by messaging the daemon directly; no host hook
 * precedes its dialog. So while enabled, this service holds a second
 * `@runtimed/node` peer per connected new notebook, watches runtime state, and
 * approves as soon as the daemon marks the notebook untrusted, mirroring the
 * dialog's "Trust & Start" (approve, then start a kernel waiting on trust) and
 * "Trust & Install" (approve, then sync a running kernel).
 *
 * Invariants:
 * - Only notebooks created here are tracked; notebooks opened from disk keep
 *   nteract's prompt.
 * - Suspected typosquats are never auto-approved, leaving the dialog and its
 *   warning in place.
 * - A dependency set whose approval failed is not retried until it changes,
 *   so a persistent daemon error cannot loop.
 * - Approval is machine-wide in runtimed: what this approves is trusted in
 *   every notebook afterwards. That is why the setting defaults to off.
 */
import type { Session } from "@runtimed/node";

import { checkTyposquats } from "../../shared/typosquat";

export type TrustSession = Pick<
	Session,
	| "runtimeState$"
	| "getDependencyStatus"
	| "getRuntimeStatus"
	| "approveTrust"
	| "restartKernel"
	| "syncEnvironment"
	| "close"
>;

export interface NewNotebookTrustOptions {
	readonly openNotebook: (notebookId: string) => Promise<TrustSession>;
	readonly isEnabled: () => boolean;
	readonly logger: { warn(message: string): void };
	/** Coalesces bursts of runtime-state updates. */
	readonly settleMs?: number;
}

interface Watched {
	session?: TrustSession;
	unsubscribe?: () => void;
	timer?: ReturnType<typeof setTimeout>;
	evaluating: boolean;
	pending: boolean;
	failedFingerprint?: string | undefined;
	closed: boolean;
}

type DependencyStatus = Awaited<ReturnType<Session["getDependencyStatus"]>>;

function needsApproval(status: DependencyStatus): boolean {
	const trust = (status.trust ?? {}) as Record<string, unknown>;
	return trust["needsApproval"] === true || trust["status"] === "untrusted";
}

function declaredSpecs(status: DependencyStatus): string[] {
	return [
		...(status.uv?.dependencies ?? []),
		...(status.conda?.dependencies ?? []),
		...(status.pixi?.dependencies ?? []),
		...(status.pixi?.pypiDependencies ?? []),
	];
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class NewNotebookTrust {
	readonly #options: NewNotebookTrustOptions;
	/** Connected notebooks created here, whether or not a peer is open for them. */
	readonly #tracked = new Set<string>();
	readonly #watched = new Map<string, Watched>();

	constructor(options: NewNotebookTrustOptions) {
		this.#options = options;
	}

	track(notebookId: string): void {
		this.#tracked.add(notebookId);
		if (this.#options.isEnabled()) this.#watch(notebookId);
	}

	untrack(notebookId: string): void {
		this.#tracked.delete(notebookId);
		void this.#unwatch(notebookId);
	}

	/** Re-reads the setting: opens peers for tracked notebooks, or closes them all. */
	refresh(): void {
		if (this.#options.isEnabled()) {
			for (const notebookId of this.#tracked) this.#watch(notebookId);
		} else {
			for (const notebookId of [...this.#watched.keys()]) void this.#unwatch(notebookId);
		}
	}

	async dispose(): Promise<void> {
		this.#tracked.clear();
		await Promise.all([...this.#watched.keys()].map((notebookId) => this.#unwatch(notebookId)));
	}

	#watch(notebookId: string): void {
		if (this.#watched.has(notebookId)) return;
		const watched: Watched = { evaluating: false, pending: false, closed: false };
		this.#watched.set(notebookId, watched);
		void this.#options.openNotebook(notebookId).then(
			(session) => {
				if (watched.closed) {
					void session.close();
					return;
				}
				watched.session = session;
				const subscription = session.runtimeState$.subscribe({
					next: () => this.#schedule(watched),
					error: (error: unknown) =>
						this.#options.logger.warn(`Notebook trust watch ended: ${message(error)}`),
				});
				watched.unsubscribe = () => subscription.unsubscribe();
				this.#schedule(watched);
			},
			(error: unknown) => {
				if (this.#watched.get(notebookId) === watched) this.#watched.delete(notebookId);
				this.#options.logger.warn(`Could not watch notebook trust: ${message(error)}`);
			},
		);
	}

	async #unwatch(notebookId: string): Promise<void> {
		const watched = this.#watched.get(notebookId);
		if (!watched) return;
		this.#watched.delete(notebookId);
		watched.closed = true;
		if (watched.timer) clearTimeout(watched.timer);
		watched.unsubscribe?.();
		await watched.session?.close().catch(() => undefined);
	}

	#schedule(watched: Watched): void {
		if (watched.closed) return;
		if (watched.timer) clearTimeout(watched.timer);
		watched.timer = setTimeout(() => void this.#evaluate(watched), this.#options.settleMs ?? 250);
		watched.timer.unref?.();
	}

	async #evaluate(watched: Watched): Promise<void> {
		const session = watched.session;
		if (watched.closed || !session || !this.#options.isEnabled()) return;
		if (watched.evaluating) {
			watched.pending = true;
			return;
		}
		watched.evaluating = true;
		try {
			const status = await session.getDependencyStatus();
			if (!needsApproval(status)) return;
			if (status.fingerprint !== undefined && status.fingerprint === watched.failedFingerprint) {
				return;
			}
			if (checkTyposquats(declaredSpecs(status)).length > 0) return;
			try {
				await session.approveTrust();
			} catch (error) {
				watched.failedFingerprint = status.fingerprint;
				this.#options.logger.warn(`Automatic notebook trust approval failed: ${message(error)}`);
				return;
			}
			const runtime = await session.getRuntimeStatus();
			if (runtime.lifecycle === "AwaitingTrust") {
				await session.restartKernel();
			} else if (runtime.lifecycle === "Running") {
				// Project-backed environments report "restart to apply" as a sync failure.
				await session.syncEnvironment().catch(() => undefined);
			}
		} catch (error) {
			this.#options.logger.warn(`Notebook trust check failed: ${message(error)}`);
		} finally {
			watched.evaluating = false;
			if (watched.pending) {
				watched.pending = false;
				this.#schedule(watched);
			}
		}
	}
}
