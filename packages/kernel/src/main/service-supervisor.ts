import type { KernelServices, ServiceRecord, ServiceStatus } from "../builtins/domain-objects";
import { KernelService, type ServiceImplementation } from "../builtins/extension-points";
import type { DomainObjectProvider } from "../domain-object-registry";
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

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
	let resolve = () => {};
	const promise = new Promise<void>((settle) => (resolve = settle));
	return { promise, resolve };
}

const RUNNING: ReadonlySet<ServiceStatus> = new Set(["starting", "ready", "restarting"]);

export interface ServiceSupervisorOptions {
	readonly extensions: ExtensionRegistry;
	readonly provider: DomainObjectProvider<typeof KernelServices>;
	readonly pluginOrder: (pluginId: string) => number;
	readonly logger: KernelLogger;
}

/**
 * Runs `kernel/service` contributions. A service is eligible when its
 * contribution is active (implemented, `when` holds) and its `startOn`
 * condition is met: `activation` once plugins are active (and the host's
 * environment is final), `window-shown` after the main window shows,
 * `first-use` once someone asks for it after booting; `ensureStarted()` on a
 * service the phase still holds waits for the phase. Crashes
 * restart with exponential backoff up to `maxRetries`; services whose
 * eligibility lapses are stopped, and one that becomes eligible again while
 * stopping starts once the stop settles. `stopPlugin()` stops a plugin's
 * services ahead of its deactivation and holds them stopped until the plugin
 * has unbound them. `restart()` starts a service afresh even
 * after it gave up or completed. At quit everything stops in reverse plugin
 * order, each stop bounded by its `stopTimeoutMs`.
 */
export class ServiceSupervisor {
	readonly #options: ServiceSupervisorOptions;
	readonly #runs = new Map<QualifiedId, Run>();
	readonly #requested = new Set<string>();
	readonly #pending = new Set<Promise<unknown>>();
	/** Plugins deactivating: their services stay stopped until the plugin unbinds them. */
	readonly #held = new Set<string>();
	#phase: Phase = "booting";
	/** Settles on the next phase change, for `ensureStarted` waiting on one. */
	#phaseChanged = deferred();

	constructor(options: ServiceSupervisorOptions) {
		this.#options = options;
		options.extensions.subscribe((pointId) => {
			if (pointId === KernelService.id) this.#reconcile();
		});
		this.#reconcile();
	}

	markActivated(): void {
		if (this.#phase === "booting") this.#setPhase("activated");
		this.#reconcile();
	}

	/** Starts window-shown services and resolves once their first start attempts settle. */
	async markWindowShown(): Promise<void> {
		if (this.#phase === "booting" || this.#phase === "activated") this.#setPhase("window-shown");
		this.#reconcile();
		await this.settled();
	}

	/**
	 * Starts a first-use service (if needed) and resolves when it is ready or
	 * completed. A service the phase still holds (booting, or window-shown
	 * before the window) is waited for.
	 */
	async ensureStarted(key: string): Promise<void> {
		this.#requested.add(key);
		this.#reconcile();
		let run = this.#runs.get(key as QualifiedId);
		while (run && !run.attempt && run.status === "idle" && this.#heldByPhase(run)) {
			await this.#phaseChanged.promise;
			run = this.#runs.get(key as QualifiedId);
		}
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

	/**
	 * Stops a plugin's services and resolves once they have stopped, before it
	 * deactivates. They aren't started again until the plugin has unbound them
	 * and binds them anew (a later activation).
	 */
	async stopPlugin(pluginId: string): Promise<void> {
		this.#held.add(pluginId);
		const runs = [...this.#runs.values()].filter((run) => run.pluginId === pluginId);
		await Promise.all(runs.map((run) => this.#stop(run)));
	}

	async stopAll(): Promise<void> {
		this.#setPhase("stopping");
		const runs = [...this.#runs.values()].sort(
			(a, b) => this.#options.pluginOrder(b.pluginId) - this.#options.pluginOrder(a.pluginId),
		);
		// Services stop one at a time in reverse plugin order so dependents stop before their dependencies.
		// react-doctor-disable-next-line react-doctor/async-await-in-loop
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
		for (const pluginId of this.#held) {
			const bound = all.some((c) => c.pluginId === pluginId && c.implementation !== undefined);
			if (!bound) this.#held.delete(pluginId);
		}
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
		if (this.#held.has(run.pluginId)) return false;
		switch (run.metadata.startOn) {
			case "activation":
				return this.#phase !== "booting";
			case "window-shown":
				return this.#phase === "window-shown";
			case "first-use":
				return this.#phase !== "booting" && this.#requested.has(run.key);
		}
	}

	/** Whether only the phase keeps `run` from starting (a later phase will start it). */
	#heldByPhase(run: Run): boolean {
		if (this.#held.has(run.pluginId) || this.#phase === "stopping") return false;
		if (this.#phase === "booting") return true;
		return run.metadata.startOn === "window-shown" && this.#phase !== "window-shown";
	}

	#setPhase(phase: Phase): void {
		this.#phase = phase;
		const changed = this.#phaseChanged;
		this.#phaseChanged = deferred();
		changed.resolve();
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
		// Its plugin may have bound it again while it was stopping, which `#reconcile` skipped.
		this.#reconcile();
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
