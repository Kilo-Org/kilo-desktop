import { z } from "zod";

import type { DomainObjectRecord } from "./discovery";
import type {
	AnyDomainObject,
	DomainObjectCaller,
	DomainObjectEventName,
	DomainObjectEventPayload,
	DomainObjectMethodImpls,
	DomainObjectMethods,
	DomainObjectState,
} from "./domain-object";
import { KernelError, serializeError } from "./errors";
import { isQualifiedId, KERNEL_OWNER, type QualifiedId } from "./ids";
import type { ObjectRef } from "./object-type";
import { WINDOW_KERNEL_PERMISSIONS } from "./permissions";
import type { KernelTransport, TransportOrigin } from "./transport";

export interface DomainObjectImpl<TDomain extends AnyDomainObject> {
	readonly initialState: DomainObjectState<TDomain>;
	readonly methods: DomainObjectMethodImpls<TDomain>;
}

/** The provider's handle: owns state and emits events. */
export interface DomainObjectProvider<TDomain extends AnyDomainObject> {
	readonly state: DomainObjectState<TDomain>;
	setState(next: DomainObjectState<TDomain>): void;
	update(updater: (state: DomainObjectState<TDomain>) => DomainObjectState<TDomain>): void;
	emit<TName extends DomainObjectEventName<TDomain>>(
		event: TName,
		payload: DomainObjectEventPayload<TDomain, TName>,
	): void;
}

/** A consumer's handle. Identical whether the provider is local or in another process. */
export interface DomainObjectHandle<TDomain extends AnyDomainObject> {
	readonly id: TDomain["id"];
	getState(): DomainObjectState<TDomain>;
	subscribe(listener: (state: DomainObjectState<TDomain>) => void): () => void;
	readonly methods: DomainObjectMethods<TDomain>;
	on<TName extends DomainObjectEventName<TDomain>>(
		event: TName,
		listener: (payload: DomainObjectEventPayload<TDomain, TName>) => void,
	): () => void;
	/** One item of a collection by its key, from the current state; `null` when absent. */
	lookup(key: string): unknown;
}

/**
 * Ties a handle's subscriptions to the caller's lifetime: registers a cleanup
 * and returns the function that runs it early and forgets it.
 */
export type DomainObjectTrack = (dispose: () => void) => () => void;

export interface DomainObjectTracker<TDomain extends AnyDomainObject> {
	added(handle: DomainObjectHandle<TDomain>): void;
	removed(): void;
}

interface InternalTracker {
	added(): void;
	removed(): void;
}

interface Entry {
	readonly definition: AnyDomainObject;
	readonly owner: string;
	state: unknown;
	readonly stateListeners: Set<(state: unknown) => void>;
	readonly eventListeners: Map<string, Set<(payload: unknown) => void>>;
	/** Present only in the home process. */
	readonly methods?: Readonly<
		Record<string, (input: unknown, caller: DomainObjectCaller) => unknown>
	>;
}

export interface DomainObjectRegistryOptions {
	readonly process: "main" | "renderer";
	readonly domainObjects: ReadonlyMap<QualifiedId, DomainObjectRecord>;
	readonly transport?: KernelTransport;
	readonly permissionsOf: (pluginId: string) => readonly string[];
	/**
	 * Main: whether a window may call as this plugin. Windows can't prove who
	 * they are, so only plugins that run in a window qualify (plus the kernel,
	 * with {@link WINDOW_KERNEL_PERMISSIONS}). Defaults to none.
	 */
	readonly isWindowCaller?: (pluginId: string) => boolean;
	readonly onUnexpectedError?: (error: unknown) => void;
	/** A state or event listener threw; `source` names the subscriber and what it listened to. */
	readonly onListenerError?: (error: unknown, source: string) => void;
}

const CHANNELS = {
	call: "kernel:domain-call",
	provided: "kernel:domain-provided",
	state: "kernel:domain-state",
	event: "kernel:domain-event",
	withdrawn: "kernel:domain-withdrawn",
} as const;

export interface DomainObjectSnapshot {
	readonly id: QualifiedId;
	readonly state: unknown;
}

const callPayload = z.object({
	domainId: z.string().refine(isQualifiedId),
	method: z.string().min(1),
	input: z.unknown(),
	caller: z.string().min(1),
});

type CallPayload = z.output<typeof callPayload>;

/**
 * Per-process registry of domain objects. A domain is provided in its home
 * process; main-home domain objects are mirrored to every renderer (state snapshots,
 * events, availability) and method calls are forwarded to main with the
 * caller's identity so permissions are checked where the provider lives.
 *
 * Main trusts the transport's origin, not the payload: a call from a window
 * is checked as coming from that window (`caller.process` is "renderer"),
 * and the plugin it claims must be one that runs in a window. Within one
 * window the claimed plugin is advisory — its plugins share a JavaScript
 * context — but a window can never act as main's kernel or a main-only
 * plugin, nor reach `homeCallersOnly` domain objects.
 *
 * Listeners are isolated: one that throws is reported and skipped, so it can't
 * starve the other listeners, stop main's broadcast to windows, or fail the
 * provider's `emit` / `setState` (and with it a method that already changed state).
 */
export class DomainObjectRegistry {
	readonly #options: DomainObjectRegistryOptions;
	readonly #entries = new Map<QualifiedId, Entry>();
	readonly #trackers = new Map<QualifiedId, Set<InternalTracker>>();
	readonly #disposers: (() => void)[] = [];
	readonly #changeListeners = new Set<
		(id: QualifiedId, change: "provided" | "withdrawn") => void
	>();

	constructor(options: DomainObjectRegistryOptions) {
		this.#options = options;
		const { transport } = options;
		if (!transport) return;
		if (options.process === "main") {
			this.#disposers.push(
				transport.handle(CHANNELS.call, (payload, from) => this.#handleRemoteCall(payload, from)),
			);
		} else {
			this.#disposers.push(
				transport.on(CHANNELS.provided, (payload) => {
					const { id, state } = payload as DomainObjectSnapshot;
					this.#mirror(id, state);
				}),
				transport.on(CHANNELS.state, (payload) => {
					const { id, state } = payload as DomainObjectSnapshot;
					const entry = this.#entries.get(id);
					if (entry && !entry.methods) this.#setState(entry, state);
				}),
				transport.on(CHANNELS.event, (payload) => {
					const {
						id,
						event,
						payload: eventPayload,
					} = payload as {
						id: QualifiedId;
						event: string;
						payload: unknown;
					};
					const entry = this.#entries.get(id);
					if (entry && !entry.methods) this.#deliverEvent(entry, event, eventPayload);
				}),
				transport.on(CHANNELS.withdrawn, (payload) => {
					const { id } = payload as { id: QualifiedId };
					const entry = this.#entries.get(id);
					if (entry && !entry.methods) this.#remove(id);
				}),
			);
		}
	}

	/** Main-home domain objects provided in this (main) process, for hydrating new windows. */
	snapshot(): DomainObjectSnapshot[] {
		return [...this.#entries.values()]
			.filter((entry) => entry.methods && entry.definition.home === "main")
			.map((entry) => ({ id: entry.definition.id, state: entry.state }));
	}

	/** Seeds mirrored domain objects in a renderer from main's snapshot. */
	hydrate(snapshots: readonly DomainObjectSnapshot[]): void {
		for (const { id, state } of snapshots) this.#mirror(id, state);
	}

	provide<TDomain extends AnyDomainObject>(
		pluginId: string,
		domain: TDomain,
		impl: DomainObjectImpl<TDomain>,
	): { provider: DomainObjectProvider<TDomain>; withdraw: () => void } {
		const record = this.#options.domainObjects.get(domain.id);
		if (!record) throw new KernelError("NOT_FOUND", `Unknown domain object "${domain.id}".`);
		if (record.owner !== pluginId) {
			throw new KernelError(
				"PERMISSION_DENIED",
				`Domain object "${domain.id}" is owned by "${record.owner}".`,
			);
		}
		if (record.definition.home !== this.#options.process) {
			throw new KernelError(
				"VALIDATION",
				`Domain object "${domain.id}" lives in the ${record.definition.home} process.`,
			);
		}
		if (this.#entries.has(domain.id)) {
			throw new KernelError("CONFLICT", `Domain object "${domain.id}" is already provided.`);
		}
		const entry: Entry = {
			definition: record.definition,
			owner: pluginId,
			state: this.#validateState(record.definition, impl.initialState),
			stateListeners: new Set(),
			eventListeners: new Map(),
			methods: impl.methods as Entry["methods"] & object,
		};
		this.#entries.set(domain.id, entry);
		this.#broadcast(entry, CHANNELS.provided, { id: domain.id, state: entry.state });
		this.#notifyTrackers(domain.id, "added");

		const provider: DomainObjectProvider<TDomain> = {
			get state() {
				return entry.state as DomainObjectState<TDomain>;
			},
			setState: (next) => {
				this.#setState(entry, this.#validateState(entry.definition, next));
				this.#broadcast(entry, CHANNELS.state, { id: domain.id, state: entry.state });
			},
			update: (updater) => provider.setState(updater(entry.state as DomainObjectState<TDomain>)),
			emit: (event, payload) => {
				const schema = entry.definition.events[event];
				if (!schema)
					throw new KernelError("NOT_FOUND", `Unknown event "${event}" on "${domain.id}".`);
				const parsed = schema.safeParse(payload);
				if (!parsed.success) {
					throw new KernelError(
						"VALIDATION",
						`Invalid payload for event "${event}" on "${domain.id}".`,
					);
				}
				this.#deliverEvent(entry, event, parsed.data);
				this.#broadcast(entry, CHANNELS.event, { id: domain.id, event, payload: parsed.data });
			},
		};
		const withdraw = () => {
			if (this.#entries.get(domain.id) !== entry) return;
			this.#remove(domain.id);
			this.#broadcast(entry, CHANNELS.withdrawn, { id: domain.id });
		};
		return { provider, withdraw };
	}

	/** A handle for `caller`, or null when no provider is available right now. */
	get<TDomain extends AnyDomainObject>(
		caller: string,
		domain: TDomain,
		track?: DomainObjectTrack,
	): DomainObjectHandle<TDomain> | null {
		const entry = this.#entries.get(domain.id);
		if (!entry) return null;
		return this.#handle<TDomain>(caller, entry, track);
	}

	track<TDomain extends AnyDomainObject>(
		caller: string,
		domain: TDomain,
		tracker: DomainObjectTracker<TDomain>,
		track?: DomainObjectTrack,
	): () => void {
		const wrapped: InternalTracker = {
			added: () => {
				const handle = this.get(caller, domain, track);
				if (handle) tracker.added(handle);
			},
			removed: () => tracker.removed(),
		};
		const set = this.#trackers.get(domain.id) ?? new Set();
		set.add(wrapped);
		this.#trackers.set(domain.id, set);
		if (this.#entries.has(domain.id)) wrapped.added();
		return () => set.delete(wrapped);
	}

	/** Notified whenever a domain becomes available or goes away in this process. */
	onChange(listener: (id: QualifiedId, change: "provided" | "withdrawn") => void): () => void {
		this.#changeListeners.add(listener);
		return () => this.#changeListeners.delete(listener);
	}

	isProvided(domainId: QualifiedId): boolean {
		return this.#entries.has(domainId);
	}

	/**
	 * Resolves a reference through the provided collection whose object type
	 * it names; `null` when no collection resolves the type or the item is gone.
	 */
	resolve(reference: ObjectRef): unknown {
		for (const entry of this.#entries.values()) {
			if (entry.definition.objectType?.id === reference.type) return lookupIn(entry, reference.id);
		}
		return null;
	}

	providedIds(): QualifiedId[] {
		return [...this.#entries.keys()];
	}

	dispose(): void {
		for (const dispose of this.#disposers.splice(0)) dispose();
	}

	#handle<TDomain extends AnyDomainObject>(
		caller: string,
		entry: Entry,
		track?: DomainObjectTrack,
	): DomainObjectHandle<TDomain> {
		const register = (dispose: () => void) => track?.(dispose) ?? dispose;
		const isolate =
			(listener: (value: unknown) => void, source: string) =>
			(value: unknown): void => {
				try {
					listener(value);
				} catch (error) {
					this.#options.onListenerError?.(error, `"${caller}" ${source}`);
				}
			};
		// One function per method name: React (and its compiler) memoizes on
		// `handle.methods.x`, so a fresh function per read would bust every memo.
		const bound = new Map<string, (input: unknown) => Promise<unknown>>();
		const methods = new Proxy(
			{},
			{
				get: (_target, method) => {
					if (typeof method !== "string") return undefined;
					let call = bound.get(method);
					if (!call) {
						call = (input: unknown) => this.#call(entry, method, input, caller);
						bound.set(method, call);
					}
					return call;
				},
			},
		) as DomainObjectMethods<TDomain>;
		return {
			id: entry.definition.id,
			getState: () => entry.state as DomainObjectState<TDomain>,
			subscribe(listener) {
				const wrapped = isolate(
					listener as (state: unknown) => void,
					`state listener on "${entry.definition.id}"`,
				);
				entry.stateListeners.add(wrapped);
				return register(() => entry.stateListeners.delete(wrapped));
			},
			methods,
			on(event, listener) {
				const set = entry.eventListeners.get(event) ?? new Set();
				const wrapped = isolate(
					listener as (payload: unknown) => void,
					`listener for "${event}" on "${entry.definition.id}"`,
				);
				set.add(wrapped);
				entry.eventListeners.set(event, set);
				return register(() => set.delete(wrapped));
			},
			lookup: (key) => lookupIn(entry, key),
		};
	}

	async #call(entry: Entry, method: string, input: unknown, caller: string): Promise<unknown> {
		if (entry.methods) {
			return this.#invokeLocal(entry, method, input, {
				pluginId: caller,
				process: this.#options.process,
			});
		}
		const transport = this.#options.transport;
		if (!transport)
			throw new KernelError("UNAVAILABLE", `"${entry.definition.id}" is not reachable.`);
		const payload: CallPayload = { domainId: entry.definition.id, method, input, caller };
		return transport.request(CHANNELS.call, payload);
	}

	async #invokeLocal(
		entry: Entry,
		method: string,
		input: unknown,
		caller: DomainObjectCaller,
	): Promise<unknown> {
		const { definition } = entry;
		// Declared methods only, so prototype names ("constructor") are never dispatched.
		// Implementations may be proxies, so they are read, not checked for own keys.
		const spec = Object.hasOwn(definition.methods, method) ? definition.methods[method] : undefined;
		const impl = spec ? entry.methods?.[method] : undefined;
		if (!spec || typeof impl !== "function") {
			throw new KernelError("NOT_FOUND", `"${definition.id}" has no method "${method}".`);
		}
		this.#assertPermission(entry, caller);
		const parsedInput = spec.input.safeParse(input);
		if (!parsedInput.success) {
			throw new KernelError("VALIDATION", `Invalid input for "${definition.id}.${method}".`);
		}
		let output: unknown;
		try {
			output = await impl(parsedInput.data, caller);
		} catch (error) {
			if (serializeError(error).code === "INTERNAL") this.#options.onUnexpectedError?.(error);
			throw error instanceof KernelError
				? error
				: new KernelError("INTERNAL", serializeError(error).message, { cause: error });
		}
		const parsedOutput = spec.output.safeParse(output);
		if (!parsedOutput.success) {
			this.#options.onUnexpectedError?.(
				new Error(`"${definition.id}.${method}" returned output that does not match its schema.`),
			);
			throw new KernelError("INTERNAL", serializeError(undefined).message);
		}
		return parsedOutput.data;
	}

	#handleRemoteCall(raw: unknown, from: TransportOrigin): Promise<unknown> {
		const parsed = callPayload.safeParse(raw);
		if (!parsed.success) throw new KernelError("VALIDATION", "Malformed domain call.");
		const payload: CallPayload = parsed.data;
		const entry = this.#entries.get(payload.domainId as QualifiedId);
		if (!entry?.methods) {
			throw new KernelError("UNAVAILABLE", `Domain object "${payload.domainId}" is not provided.`);
		}
		const caller: DomainObjectCaller =
			from.process === "renderer"
				? { pluginId: payload.caller, process: "renderer", windowId: from.windowId }
				: { pluginId: payload.caller, process: "main" };
		if (caller.process === "renderer" && !this.#mayCallFromWindow(caller.pluginId)) {
			throw new KernelError(
				"PERMISSION_DENIED",
				`A window can't call "${payload.domainId}" as "${caller.pluginId}".`,
			);
		}
		return this.#invokeLocal(entry, payload.method, payload.input, caller);
	}

	#mayCallFromWindow(pluginId: string): boolean {
		return pluginId === KERNEL_OWNER || (this.#options.isWindowCaller?.(pluginId) ?? false);
	}

	#assertPermission(entry: Entry, caller: DomainObjectCaller): void {
		const { definition } = entry;
		const local = caller.process === this.#options.process;
		if (definition.homeCallersOnly && !local) {
			throw new KernelError(
				"PERMISSION_DENIED",
				`"${definition.id}" can only be called from the ${definition.home} process.`,
			);
		}
		const permission = definition.permission;
		if (!permission) return;
		// The kernel is fully trusted only in its own process.
		if (caller.pluginId === KERNEL_OWNER ? local : caller.pluginId === entry.owner) return;
		const granted =
			caller.pluginId === KERNEL_OWNER
				? WINDOW_KERNEL_PERMISSIONS
				: this.#options.permissionsOf(caller.pluginId);
		if (granted.includes(permission)) return;
		throw new KernelError(
			"PERMISSION_DENIED",
			`"${caller.pluginId}" needs the "${permission}" permission to use "${definition.id}".`,
		);
	}

	#validateState(definition: AnyDomainObject, state: unknown): unknown {
		const parsed = definition.state.safeParse(state);
		if (!parsed.success) {
			throw new KernelError("VALIDATION", `Invalid state for domain object "${definition.id}".`);
		}
		return parsed.data;
	}

	#mirror(id: QualifiedId, state: unknown): void {
		const record = this.#options.domainObjects.get(id);
		if (!record) return;
		const existing = this.#entries.get(id);
		if (existing) {
			if (!existing.methods) this.#setState(existing, state);
			return;
		}
		this.#entries.set(id, {
			definition: record.definition,
			owner: record.owner,
			state,
			stateListeners: new Set(),
			eventListeners: new Map(),
		});
		this.#notifyTrackers(id, "added");
	}

	#setState(entry: Entry, state: unknown): void {
		entry.state = state;
		for (const listener of [...entry.stateListeners]) listener(state);
	}

	#deliverEvent(entry: Entry, event: string, payload: unknown): void {
		for (const listener of [...(entry.eventListeners.get(event) ?? [])]) listener(payload);
	}

	#remove(id: QualifiedId): void {
		this.#entries.delete(id);
		this.#notifyTrackers(id, "removed");
	}

	#broadcast(entry: Entry, channel: string, payload: unknown): void {
		if (entry.definition.home !== "main" || this.#options.process !== "main") return;
		this.#options.transport?.send(channel, payload);
	}

	#notifyTrackers(id: QualifiedId, kind: "added" | "removed"): void {
		for (const listener of [...this.#changeListeners]) {
			listener(id, kind === "added" ? "provided" : "withdrawn");
		}
		for (const tracker of [...(this.#trackers.get(id) ?? [])]) {
			if (kind === "added") tracker.added();
			else tracker.removed();
		}
	}
}

function lookupIn(entry: Entry, key: string): unknown {
	return entry.definition.lookup?.(entry.state, key) ?? null;
}
