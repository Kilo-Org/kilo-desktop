import type { KernelServices, ServiceRecord, ServiceStatus } from "../builtins/domains";
import { KernelService, type ServiceImplementation } from "../builtins/points";
import type { DomainProvider } from "../domain-registry";
import type { MetadataOf } from "../extension-point";
import type { Contribution, ExtensionRegistry } from "../extension-registry";
import type { QualifiedId } from "../ids";
import type { KernelLogger } from "../sdk";

type ServiceMetadata = MetadataOf<typeof KernelService>;

type Phase = "booting" | "activated" | "window-shown" | "stopping";

interface Run {
	readonly key: QualifiedId;
	readonly pluginId: string;
	metadata: ServiceMetadata;
	implementation: ServiceImplementation;
	status: ServiceStatus;
	restarts: number;
	controller: AbortController | undefined;
	timer: ReturnType<typeof setTimeout> | undefined;
	attempt: Promise<void> | undefined;
}

const RUNNING: ReadonlySet<ServiceStatus> = new Set(["starting", "ready", "restarting"]);

export interface ServiceSupervisorOptions {
	readonly extensions: ExtensionRegistry;
	readonly provider: DomainProvider<typeof KernelServices>;
	readonly pluginOrder: (pluginId: string) => number;
	readonly logger: KernelLogger;
}

/**
 * Runs `kernel/service` contributions. A service is eligible when its
 * contribution is active (implemented, `when` holds) and its `startOn`
 * condition is met: `activation` once plugins are active, `window-shown`
 * after the main window shows, `first-use` once someone asks for it. Crashes
 * restart with exponential backoff up to `maxRetries`; services whose
 * eligibility lapses are stopped. `restart()` starts a service afresh even
 * after it gave up or completed. At quit everything stops in reverse plugin
 * order, each stop bounded by its `stopTimeoutMs`.
 */
export class ServiceSupervisor {
	readonly #options: ServiceSupervisorOptions;
	readonly #runs = new Map<QualifiedId, Run>();
	readonly #requested = new Set<string>();
	readonly #pending = new Set<Promise<unknown>>();
	#phase: Phase = "booting";

	constructor(options: ServiceSupervisorOptions) {
		this.#options = options;
		options.extensions.subscribe((pointId) => {
			if (pointId === KernelService.id) this.#reconcile();
		});
		this.#reconcile();
	}

	markActivated(): void {
		if (this.#phase === "booting") this.#phase = "activated";
		this.#reconcile();
	}

	/** Starts window-shown services and resolves once their first start attempts settle. */
	async markWindowShown(): Promise<void> {
		if (this.#phase === "booting" || this.#phase === "activated") this.#phase = "window-shown";
		this.#reconcile();
		await this.settled();
	}

	/** Starts a first-use service (if needed) and resolves when it is ready or completed. */
	async ensureStarted(key: string): Promise<void> {
		this.#requested.add(key);
		this.#reconcile();
		const run = this.#runs.get(key as QualifiedId);
		if (run?.attempt) await run.attempt;
		if (run?.status === "failed") throw new Error(`Service "${key}" failed to start.`);
	}

	async restart(key: string): Promise<void> {
		const run = this.#runs.get(key as QualifiedId);
		if (!run) return;
		await this.#stop(run);
		run.restarts = 0;
		// A service that gave up (or finished) is otherwise never started again.
		if (run.status === "failed" || run.status === "completed") {
			this.#setStatus(run, "idle", { progress: undefined, error: undefined });
		}
		this.#requested.add(key);
		this.#reconcile();
		await this.settled();
	}

	/** Resolves once every in-flight start, stop and restart attempt has finished. */
	async settled(): Promise<void> {
		while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
	}

	async stopAll(): Promise<void> {
		this.#phase = "stopping";
		const runs = [...this.#runs.values()].sort(
			(a, b) => this.#options.pluginOrder(b.pluginId) - this.#options.pluginOrder(a.pluginId),
		);
		for (const run of runs) await this.#stop(run);
	}

	#reconcile(): void {
		const all = this.#options.extensions.all(KernelService);
		const active = new Map(
			this.#options.extensions
				.list(KernelService)
				.map((contribution) => [contribution.key, contribution]),
		);
		for (const contribution of all) this.#ensureRecord(contribution);
		if (this.#phase === "stopping") return;

		for (const run of this.#runs.values()) {
			const contribution = active.get(run.key);
			if (!contribution?.implementation) {
				if (RUNNING.has(run.status)) this.#track(this.#stop(run));
				continue;
			}
			run.implementation = contribution.implementation;
			run.metadata = contribution.metadata;
			if (!RUNNING.has(run.status) && run.status !== "stopping" && this.#eligible(run)) {
				if (run.status === "completed" || run.status === "failed") continue;
				this.#start(run);
			}
		}
	}

	#eligible(run: Run): boolean {
		switch (run.metadata.startOn) {
			case "activation":
				return this.#phase !== "booting";
			case "window-shown":
				return this.#phase === "window-shown";
			case "first-use":
				return this.#requested.has(run.key);
		}
	}

	#ensureRecord(contribution: Contribution<typeof KernelService>): void {
		if (this.#runs.has(contribution.key)) return;
		const run: Run = {
			key: contribution.key,
			pluginId: contribution.pluginId,
			metadata: contribution.metadata,
			implementation: contribution.implementation ?? { start: () => {} },
			status: "idle",
			restarts: 0,
			controller: undefined,
			timer: undefined,
			attempt: undefined,
		};
		this.#runs.set(run.key, run);
		this.#publish(run);
	}

	#start(run: Run): void {
		const controller = new AbortController();
		run.controller = controller;
		this.#setStatus(run, "starting", { progress: undefined, error: undefined });
		const attempt = (async () => {
			try {
				await run.implementation.start({
					signal: controller.signal,
					progress: (message) => {
						if (run.controller === controller)
							this.#setStatus(run, run.status, { progress: message });
					},
					fail: (error) => {
						if (run.controller === controller && run.status === "ready")
							this.#onFailure(run, error);
					},
				});
				if (controller.signal.aborted || run.controller !== controller) return;
				// Start-up progress is over; a ready daemon may report new progress later.
				this.#setStatus(run, run.metadata.kind === "daemon" ? "ready" : "completed", {
					progress: undefined,
				});
			} catch (error) {
				if (controller.signal.aborted || run.controller !== controller) return;
				this.#onFailure(run, error);
			}
		})();
		run.attempt = attempt;
		this.#track(attempt);
	}

	#onFailure(run: Run, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.#options.logger.error(`Service "${run.key}" failed: ${message}`);
		const { restart } = run.metadata;
		if (
			restart.policy === "on-failure" &&
			run.restarts < restart.maxRetries &&
			this.#phase !== "stopping"
		) {
			const delay = Math.min(restart.initialDelayMs * 2 ** run.restarts, restart.maxDelayMs);
			run.restarts += 1;
			this.#setStatus(run, "restarting", { error: message });
			run.timer = setTimeout(() => {
				run.timer = undefined;
				if (run.status === "restarting") this.#start(run);
			}, delay);
			return;
		}
		this.#setStatus(run, "failed", { error: message });
	}

	async #stop(run: Run): Promise<void> {
		if (run.timer !== undefined) {
			clearTimeout(run.timer);
			run.timer = undefined;
		}
		const wasRunning = run.status === "starting" || run.status === "ready";
		if (!RUNNING.has(run.status)) return;
		this.#setStatus(run, "stopping");
		run.controller?.abort();
		run.controller = undefined;
		if (wasRunning && run.implementation.stop) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					Promise.resolve().then(() => run.implementation.stop!()),
					new Promise<void>((resolve) => {
						timer = setTimeout(() => {
							this.#options.logger.warn(
								`Service "${run.key}" did not stop within ${run.metadata.stopTimeoutMs} ms.`,
							);
							resolve();
						}, run.metadata.stopTimeoutMs);
					}),
				]);
			} catch (error) {
				this.#options.logger.error(`Service "${run.key}" failed to stop cleanly`, error);
			} finally {
				if (timer !== undefined) clearTimeout(timer);
			}
		}
		this.#setStatus(run, "stopped");
	}

	#track(promise: Promise<unknown>): void {
		this.#pending.add(promise);
		void promise.finally(() => this.#pending.delete(promise));
	}

	#setStatus(
		run: Run,
		status: ServiceStatus,
		patch: { progress?: string | undefined; error?: string | undefined } = {},
	): void {
		const changed = run.status !== status;
		run.status = status;
		this.#publish(run, patch);
		if (changed) this.#options.provider.emit("status-changed", { key: run.key, status });
	}

	#publish(
		run: Run,
		patch: { progress?: string | undefined; error?: string | undefined } = {},
	): void {
		const previous = this.#options.provider.state.services[run.key];
		const progress = "progress" in patch ? patch.progress : previous?.progress;
		const error = "error" in patch ? patch.error : previous?.error;
		const record: ServiceRecord = {
			pluginId: run.pluginId,
			title: run.metadata.title,
			kind: run.metadata.kind,
			status: run.status,
			restarts: run.restarts,
			...(progress === undefined ? {} : { progress }),
			...(error === undefined ? {} : { error }),
		};
		this.#options.provider.update((state) => ({
			services: { ...state.services, [run.key]: record },
		}));
	}
}
