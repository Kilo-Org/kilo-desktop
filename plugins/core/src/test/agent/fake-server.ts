import { vi } from "vitest";

import type { AgentServerManager, ServerInput } from "../../main/agent";
import type { KiloServerConnection, KiloServerStatus } from "../../main/agent/types";

export const CONNECTION: KiloServerConnection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "opencode",
	password: "secret",
	version: "0.0.0-v2-239",
	globalDirectory: "/home",
};

/** Behaves like KiloServerManager without a process: records what each spawn saw. */
export class FakeServer implements AgentServerManager {
	status: KiloServerStatus = { status: "stopped" };
	readonly spawns: Record<string, string>[] = [];
	readonly endpoints: unknown[] = [];
	readonly restart = vi.fn(async () => {
		await this.stop();
		return this.ensureRunning();
	});
	#spawnedEnv: Record<string, string> | undefined;
	#spawnedEndpoint: unknown;
	startGate: Promise<void> = Promise.resolve();

	constructor(readonly input: ServerInput) {}

	get isRunning() {
		return this.status.status === "ready";
	}
	get isStarting() {
		return this.status.status === "starting";
	}
	async ensureRunning() {
		if (!this.isRunning) {
			this.#set({ status: "starting" });
			await this.startGate;
			this.#spawnedEnv = this.input.contributedEnv.getMergedEnv();
			this.#spawnedEndpoint = this.input.webMcpEndpoint();
			this.spawns.push(this.#spawnedEnv);
			this.endpoints.push(this.input.webMcpEndpoint());
			this.#set({ status: "ready", baseUrl: CONNECTION.baseUrl, version: CONNECTION.version });
		}
		return CONNECTION;
	}
	async stop() {
		this.#set({ status: "stopped" });
	}
	contributedEnvChangedSinceSpawn() {
		return (
			JSON.stringify(this.#spawnedEnv) !== JSON.stringify(this.input.contributedEnv.getMergedEnv())
		);
	}
	webMcpEndpointChangedSinceSpawn() {
		return this.isRunning && this.input.webMcpEndpoint() !== this.#spawnedEndpoint;
	}
	dispose() {
		this.#set({ status: "stopped" });
	}
	crash(message: string) {
		this.#set({ status: "error", message });
	}
	#set(status: KiloServerStatus) {
		this.status = status;
		this.input.onStatusChange(status);
	}
}
