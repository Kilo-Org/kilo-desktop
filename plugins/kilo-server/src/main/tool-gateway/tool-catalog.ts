import { randomUUID } from "node:crypto";

import {
	toolCatalogProducerMessageSchema,
	toolDescriptorSchema,
	type HostMessagePort,
	type ToolCatalogConsumerMessage,
	type ToolDescriptor,
} from "@kilo-desktop/feature-sdk";

/**
 * Main-process copy of the app's agent tools, published by the renderer that
 * owns the `ToolRegistry`, and the call path back to it.
 *
 * Ownership and invariants:
 * - Only the app renderer can contribute tools: they arrive over a MessagePort
 *   that the shell accepts solely from trusted app frames. There is no other
 *   way in, so tool names are never shared with, or renamed for, a foreign
 *   producer. A duplicate name inside one snapshot keeps the first tool.
 * - One producer at a time. A newly attached port replaces the previous one
 *   (a reloaded window opens a new port); the replaced port is closed and its
 *   pending calls fail.
 * - Each snapshot replaces the whole catalog. Subscribers are notified, and
 *   `version` bumped, only when the validated tool list actually changed, so a
 *   reload that republishes the same tools causes no churn downstream.
 * - When the producer disconnects, the last tools stay listed for a short
 *   grace period (calls fail fast) so consumers do not see every tool vanish
 *   and reappear across a window reload.
 * - Cancellation is best-effort: the renderer's tool handlers take no abort
 *   signal, so a cancel only drops the pending call here and tells the
 *   renderer to discard the late result. The handler itself keeps running.
 * - There is no call timeout (some tools run long jobs). Pending calls end on
 *   a result, a cancel, a producer disconnect/replacement, or `dispose`.
 */

export type ToolCallContext = {
	readonly kiloSessionId?: string;
	readonly kiloCallId?: string;
};

export interface ToolCatalogLogger {
	warn(message: string): void;
}

export interface ToolCatalogOptions {
	readonly logger?: ToolCatalogLogger;
	/** How long the last tools stay listed after the producer disconnects. */
	readonly reloadGraceMs?: number;
}

const DEFAULT_RELOAD_GRACE_MS = 5_000;
/** Upper bound on the serialized size of one snapshot's tools. */
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

const NOT_CONNECTED =
	"Kilo Desktop's window is not connected (it may be reloading). Try again in a moment.";
const OUTCOME_UNKNOWN =
	"Kilo Desktop's window disconnected before the tool finished, so its outcome is unknown. " +
	"Check the current state before retrying.";
const CANCELLED = "The tool call was cancelled. The tool may still finish in Kilo Desktop.";

interface Producer {
	readonly port: HostMessagePort;
	revision: number;
	readonly onMessage: (event: { data: unknown }) => void;
	readonly onClose: () => void;
}

interface PendingCall {
	readonly producer: Producer;
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly release: () => void;
}

export class ToolCatalog {
	readonly #logger: ToolCatalogLogger | undefined;
	readonly #reloadGraceMs: number;
	readonly #listeners = new Set<() => void>();
	readonly #pending = new Map<string, PendingCall>();
	#tools: readonly ToolDescriptor[] = [];
	#toolNames = new Set<string>();
	#signature = "[]";
	#version = 0;
	#producer: Producer | undefined;
	#graceTimer: ReturnType<typeof setTimeout> | undefined;
	#disposed = false;

	constructor(options: ToolCatalogOptions = {}) {
		this.#logger = options.logger;
		this.#reloadGraceMs = options.reloadGraceMs ?? DEFAULT_RELOAD_GRACE_MS;
	}

	/** Bumped each time the tool list changes. */
	get version(): number {
		return this.#version;
	}

	get tools(): readonly ToolDescriptor[] {
		return this.#tools;
	}

	get pendingCount(): number {
		return this.#pending.size;
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Make `port` the active producer, replacing any previous one. */
	attach(port: HostMessagePort): void {
		if (this.#disposed) {
			port.close();
			return;
		}
		const previous = this.#producer;
		if (previous) this.#detach(previous, { closePort: true });
		this.#clearGraceTimer();
		const producer: Producer = {
			port,
			revision: -1,
			onMessage: (event) => this.#handleMessage(producer, event.data),
			onClose: () => this.#handleClose(producer),
		};
		this.#producer = producer;
		port.on("message", producer.onMessage);
		port.on("close", producer.onClose);
		port.start();
	}

	invoke(
		name: string,
		args: Record<string, unknown>,
		context: ToolCallContext,
		signal?: AbortSignal,
	): Promise<unknown> {
		if (signal?.aborted) return Promise.reject(new Error(CANCELLED));
		const producer = this.#producer;
		if (!producer) return Promise.reject(new Error(NOT_CONNECTED));
		if (!this.#toolNames.has(name)) return Promise.reject(new Error(`Unknown tool "${name}".`));

		const id = randomUUID();
		return new Promise<unknown>((resolve, reject) => {
			const onAbort = (): void => {
				if (!this.#pending.delete(id)) return;
				signal?.removeEventListener("abort", onAbort);
				this.#post(producer, { type: "cancel", id });
				reject(new Error(CANCELLED));
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			this.#pending.set(id, {
				producer,
				resolve,
				reject,
				release: () => signal?.removeEventListener("abort", onAbort),
			});
			this.#post(producer, { type: "call", id, name, args, context });
		});
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#clearGraceTimer();
		const producer = this.#producer;
		if (producer) this.#detach(producer, { closePort: true });
		this.#listeners.clear();
	}

	#handleMessage(producer: Producer, data: unknown): void {
		if (producer !== this.#producer) return;
		const parsed = toolCatalogProducerMessageSchema.safeParse(data);
		if (!parsed.success) {
			this.#logger?.warn("Ignored a malformed tool catalog message from the app window.");
			return;
		}
		const message = parsed.data;
		if (message.type === "catalog") {
			if (message.revision <= producer.revision) return;
			producer.revision = message.revision;
			this.#applySnapshot(message.tools);
			return;
		}
		const pending = this.#pending.get(message.id);
		if (!pending || pending.producer !== producer) return;
		this.#pending.delete(message.id);
		pending.release();
		if (message.ok) pending.resolve(message.result);
		else pending.reject(new Error(message.error.message));
	}

	#applySnapshot(rawTools: readonly unknown[]): void {
		if (JSON.stringify(rawTools).length > MAX_SNAPSHOT_BYTES) {
			this.#logger?.warn("Ignored a tool catalog snapshot that exceeds the size limit.");
			return;
		}
		const tools: ToolDescriptor[] = [];
		const names = new Set<string>();
		for (const raw of rawTools) {
			const parsed = toolDescriptorSchema.safeParse(raw);
			if (!parsed.success) {
				this.#logger?.warn("Ignored an invalid tool descriptor from the app window.");
				continue;
			}
			if (names.has(parsed.data.name)) {
				this.#logger?.warn(`Ignored a duplicate tool named "${parsed.data.name}".`);
				continue;
			}
			names.add(parsed.data.name);
			tools.push(parsed.data);
		}
		this.#replaceTools(tools, names);
	}

	#replaceTools(tools: readonly ToolDescriptor[], names: Set<string>): void {
		const signature = JSON.stringify(tools);
		if (signature === this.#signature) return;
		this.#tools = tools;
		this.#toolNames = names;
		this.#signature = signature;
		this.#version += 1;
		for (const listener of [...this.#listeners]) listener();
	}

	#handleClose(producer: Producer): void {
		if (producer !== this.#producer) return;
		this.#detach(producer, { closePort: false });
		this.#graceTimer = setTimeout(() => {
			this.#graceTimer = undefined;
			if (!this.#producer) this.#replaceTools([], new Set());
		}, this.#reloadGraceMs);
	}

	#detach(producer: Producer, { closePort }: { closePort: boolean }): void {
		producer.port.off("message", producer.onMessage);
		producer.port.off("close", producer.onClose);
		if (closePort) producer.port.close();
		if (this.#producer === producer) this.#producer = undefined;
		for (const [id, pending] of this.#pending) {
			if (pending.producer !== producer) continue;
			this.#pending.delete(id);
			pending.release();
			pending.reject(new Error(OUTCOME_UNKNOWN));
		}
	}

	#clearGraceTimer(): void {
		if (this.#graceTimer === undefined) return;
		clearTimeout(this.#graceTimer);
		this.#graceTimer = undefined;
	}

	#post(producer: Producer, message: ToolCatalogConsumerMessage): void {
		try {
			producer.port.postMessage(message);
		} catch (error) {
			this.#logger?.warn(
				`Could not reach the app window: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
