import {
	parseContributionEntry,
	type DiscoveredContribution,
	type ParsedContributionEntry,
	type ExtensionPointRecord,
} from "./discovery";
import { KernelError } from "./errors";
import type {
	AnyExtensionPoint,
	DecisionAnswer,
	DecisionHandler,
	ImplementationOf,
	MetadataOf,
} from "./extension-point";
import type { QualifiedId } from "./ids";
import { whenKeys, type ContextKeyStore, type WhenExpression } from "./when";

/** Prefix of a window's origin for {@link ExtensionRegistry.setRemoteImplementations}. */
export const WINDOW_ORIGIN_PREFIX = "window:";

export function windowOrigin(windowId: string): string {
	return `${WINDOW_ORIGIN_PREFIX}${windowId}`;
}

/** A contribution as seen by hosts. `key` is `<plugin>/<local id>`. */
export interface Contribution<TPoint extends AnyExtensionPoint = AnyExtensionPoint> {
	readonly key: QualifiedId;
	readonly pointId: QualifiedId;
	readonly pluginId: string;
	readonly id: string;
	readonly priority: number;
	readonly when?: WhenExpression;
	readonly metadata: MetadataOf<TPoint>;
	/** Present when bound in this process. */
	readonly implementation?: ImplementationOf<TPoint>;
	/** True when the implementation is bound in another process. */
	readonly implementedRemotely: boolean;
	readonly source: "manifest" | "runtime";
}

export interface ExclusiveResolution<TPoint extends AnyExtensionPoint = AnyExtensionPoint> {
	readonly winner?: Contribution<TPoint>;
	/** Candidates in fallback order, winner first. */
	readonly chain: readonly Contribution<TPoint>[];
}

export type DecisionOutcome =
	| { readonly outcome: "proceed" }
	| { readonly outcome: "ask"; readonly reasons: readonly string[] }
	| { readonly outcome: "reject"; readonly reason: string };

interface ContributionRecord {
	readonly key: QualifiedId;
	readonly pointId: QualifiedId;
	readonly pluginId: string;
	readonly id: string;
	readonly source: "manifest" | "runtime";
	readonly order: number;
	entry: ParsedContributionEntry;
	implementation?: unknown;
}

/** A runtime contribution to a point whose owner isn't installed: never stored or listed. */
function ignoredContribution(
	pluginId: string,
	pointId: QualifiedId,
	rawEntry: Readonly<Record<string, unknown>>,
): ContributionRecord {
	const id = typeof rawEntry["id"] === "string" ? rawEntry["id"] : "";
	return {
		key: `${pluginId}/${id}`,
		pointId,
		pluginId,
		id,
		source: "runtime",
		order: -1,
		entry: { id, priority: 0 } as ParsedContributionEntry,
	};
}

export interface ExtensionRegistryOptions {
	readonly process: "main" | "renderer";
	readonly extensionPoints: ReadonlyMap<QualifiedId, ExtensionPointRecord>;
	readonly contextKeys: ContextKeyStore;
	/** Activation order of plugins; ties in priority follow it. */
	readonly pluginOrder: (pluginId: string) => number;
	/** Whether a plugin (or the kernel) is installed in this process. */
	readonly isInstalled?: (pluginId: string) => boolean;
	readonly onDecisionError?: (key: QualifiedId, error: unknown) => void;
}

/**
 * Per-process registry of extension points and their contributions.
 * Manifest contributions exist in every process; runtime contributions and
 * implementations are local to the process that registered them, with
 * implementation keys mirrored across the boundary so hosts know a
 * contribution is live elsewhere.
 */
export class ExtensionRegistry {
	readonly #options: ExtensionRegistryOptions;
	readonly #records = new Map<QualifiedId, Map<QualifiedId, ContributionRecord>>();
	readonly #pins = new Map<QualifiedId, QualifiedId>();
	readonly #failed = new Map<QualifiedId, Set<QualifiedId>>();
	readonly #remote = new Map<string, Map<QualifiedId, Set<QualifiedId>>>();
	readonly #listeners = new Set<(pointId: QualifiedId) => void>();
	readonly #implementationListeners = new Set<() => void>();
	#sequence = 0;

	constructor(options: ExtensionRegistryOptions) {
		this.#options = options;
		options.contextKeys.subscribe((changedKeys) => {
			for (const [pointId, records] of this.#records) {
				if (readsAny(records.values(), changedKeys)) this.#notify(pointId);
			}
		});
	}

	hasPoint(pointId: QualifiedId): boolean {
		return this.#options.extensionPoints.has(pointId);
	}

	/**
	 * True when `pointId` belongs to a plugin that isn't installed: contributing
	 * to it is an optional integration that doesn't apply, so it is ignored
	 * (discovery already warned) rather than failing the contributor, and
	 * reading it finds no contributions rather than failing the host.
	 */
	#ownerAbsent(pointId: QualifiedId): boolean {
		if (this.#options.extensionPoints.has(pointId)) return false;
		const owner = pointId.slice(0, pointId.indexOf("/"));
		return this.#options.isInstalled !== undefined && !this.#options.isInstalled(owner);
	}

	point(pointId: QualifiedId): ExtensionPointRecord {
		const record = this.#options.extensionPoints.get(pointId);
		if (!record) throw new KernelError("NOT_FOUND", `Unknown extension point "${pointId}".`);
		return record;
	}

	addManifestContribution(contribution: DiscoveredContribution): void {
		this.#insert({
			key: `${contribution.pluginId}/${contribution.entry.id}`,
			pointId: contribution.pointId,
			pluginId: contribution.pluginId,
			id: contribution.entry.id,
			source: "manifest",
			order: this.#sequence++,
			entry: contribution.entry,
		});
	}

	/** Adds a runtime contribution validated against the point's metadata schema. */
	add(
		pluginId: string,
		point: AnyExtensionPoint,
		rawEntry: Readonly<Record<string, unknown>>,
		implementation?: unknown,
	): ContributionRecord {
		if (this.#ownerAbsent(point.id)) return ignoredContribution(pluginId, point.id, rawEntry);
		const record = this.point(point.id);
		const parsed = parseContributionEntry(rawEntry, record.definition);
		if (!parsed.ok) throw new KernelError("VALIDATION", parsed.message);
		const key: QualifiedId = `${pluginId}/${parsed.entry.id}`;
		if (this.#records.get(point.id)?.has(key)) {
			throw new KernelError("CONFLICT", `"${key}" already contributes to "${point.id}".`);
		}
		if (implementation !== undefined) this.#assertProcess(record.definition);
		const contribution: ContributionRecord = {
			key,
			pointId: point.id,
			pluginId,
			id: parsed.entry.id,
			source: "runtime",
			order: this.#sequence++,
			entry: parsed.entry,
			...(implementation === undefined ? {} : { implementation }),
		};
		this.#insert(contribution);
		if (implementation !== undefined) this.#notifyImplementations();
		return contribution;
	}

	/** Replaces a runtime contribution's metadata (merged over the current entry). */
	update(pointId: QualifiedId, key: QualifiedId, patch: Readonly<Record<string, unknown>>): void {
		const record = this.#records.get(pointId)?.get(key);
		if (!record) throw new KernelError("NOT_FOUND", `No contribution "${key}" to "${pointId}".`);
		const merged = {
			...(record.entry.metadata as Record<string, unknown>),
			id: record.id,
			priority: record.entry.priority,
			...(record.entry.when ? { when: record.entry.when } : {}),
			...patch,
		};
		const parsed = parseContributionEntry(merged, this.point(pointId).definition);
		if (!parsed.ok) throw new KernelError("VALIDATION", parsed.message);
		record.entry = { ...parsed.entry, id: record.id };
		this.#notify(pointId);
	}

	remove(pointId: QualifiedId, key: QualifiedId): void {
		const removed = this.#records.get(pointId)?.delete(key);
		if (removed) {
			this.#notify(pointId);
			this.#notifyImplementations();
		}
	}

	/** Binds code to an existing contribution of `pluginId`. Returns the unbind function. */
	implement(
		pluginId: string,
		point: AnyExtensionPoint,
		id: string,
		implementation: unknown,
	): () => void {
		if (this.#ownerAbsent(point.id)) return () => {};
		const { definition } = this.point(point.id);
		this.#assertProcess(definition);
		const key: QualifiedId = `${pluginId}/${id}`;
		const record = this.#records.get(point.id)?.get(key);
		if (!record) {
			throw new KernelError(
				"NOT_FOUND",
				`There is no contribution "${id}" from "${pluginId}" to "${point.id}" to implement.`,
			);
		}
		if (record.implementation !== undefined) {
			throw new KernelError("CONFLICT", `"${key}" is already implemented.`);
		}
		record.implementation = implementation;
		this.#notify(point.id);
		this.#notifyImplementations();
		return () => {
			if (record.implementation !== implementation) return;
			delete record.implementation;
			this.#notify(point.id);
			this.#notifyImplementations();
		};
	}

	/** Removes every contribution and implementation of a plugin. */
	removePlugin(pluginId: string): void {
		for (const [pointId, records] of this.#records) {
			let changed = false;
			for (const [key, record] of records) {
				if (record.pluginId === pluginId) {
					records.delete(key);
					changed = true;
				}
			}
			if (changed) this.#notify(pointId);
		}
		this.#notifyImplementations();
	}

	/** Active contributions: `when` holds and, if required, an implementation is bound somewhere. */
	list<TPoint extends AnyExtensionPoint>(point: TPoint | QualifiedId): Contribution<TPoint>[] {
		const pointId = typeof point === "string" ? point : point.id;
		if (this.#ownerAbsent(pointId)) return [];
		const { definition } = this.point(pointId);
		const required = definition.implementation?.required ?? false;
		const contributions: Contribution<TPoint>[] = [];
		for (const record of this.#records.get(pointId)?.values() ?? []) {
			if (!this.#options.contextKeys.evaluate(record.entry.when)) continue;
			const implementedRemotely = this.#isRemotelyImplemented(pointId, record.key);
			if (required && record.implementation === undefined && !implementedRemotely) continue;
			contributions.push(this.#view<TPoint>(record, implementedRemotely));
		}
		return contributions.sort((a, b) => this.#compare(a, b));
	}

	/** Every contribution to a point, ignoring `when` and implementation state. */
	all<TPoint extends AnyExtensionPoint>(point: TPoint | QualifiedId): Contribution<TPoint>[] {
		const pointId = typeof point === "string" ? point : point.id;
		if (this.#ownerAbsent(pointId)) return [];
		this.point(pointId);
		return [...(this.#records.get(pointId)?.values() ?? [])]
			.map((record) => this.#view<TPoint>(record, this.#isRemotelyImplemented(pointId, record.key)))
			.sort((a, b) => this.#compare(a, b));
	}

	/** Origins (`main`, `window:<id>`) that implement a contribution in another process. */
	implementationOrigins(pointId: QualifiedId, key: QualifiedId): string[] {
		return [...this.#remote.entries()]
			.filter(([, implementations]) => implementations.get(pointId)?.has(key))
			.map(([origin]) => origin);
	}

	/** The winning contribution of an exclusive point plus its fallback chain. */
	exclusive<TPoint extends AnyExtensionPoint>(
		point: TPoint | QualifiedId,
	): ExclusiveResolution<TPoint> {
		const pointId = typeof point === "string" ? point : point.id;
		const failed = this.#failed.get(pointId);
		const candidates = this.list<TPoint>(pointId).filter((c) => !failed?.has(c.key));
		const pinned = this.#pins.get(pointId);
		const pinnedIndex = candidates.findIndex((c) => c.key === pinned);
		if (pinnedIndex > 0) candidates.unshift(...candidates.splice(pinnedIndex, 1));
		return { ...(candidates[0] ? { winner: candidates[0] } : {}), chain: candidates };
	}

	pin(pointId: QualifiedId, key: QualifiedId | null): void {
		if (key === null) this.#pins.delete(pointId);
		else this.#pins.set(pointId, key);
		this.#notify(pointId);
	}

	reportFailure(pointId: QualifiedId, key: QualifiedId, _error?: unknown): void {
		const failed = this.#failed.get(pointId) ?? new Set();
		failed.add(key);
		this.#failed.set(pointId, failed);
		this.#notify(pointId);
	}

	/** Asks every decision handler in order and merges their answers. */
	async decide(point: AnyExtensionPoint, input: unknown): Promise<DecisionOutcome> {
		const { definition } = this.point(point.id);
		const spec = definition.decision;
		if (definition.kind !== "decision" || !spec) {
			throw new KernelError("VALIDATION", `"${point.id}" is not a decision point.`);
		}
		const parsed = spec.input.safeParse(input);
		if (!parsed.success) {
			throw new KernelError("VALIDATION", `Invalid input for decision "${point.id}".`);
		}
		const reasons: string[] = [];
		for (const contribution of this.list(point.id)) {
			const handler = contribution.implementation as DecisionHandler<unknown> | undefined;
			if (!handler) continue;
			const answer = await this.#answer(contribution.key, handler, parsed.data, spec);
			if (answer === "proceed") continue;
			if ("reject" in answer) return { outcome: "reject", reason: answer.reject };
			reasons.push(answer.ask);
		}
		return reasons.length > 0 ? { outcome: "ask", reasons } : { outcome: "proceed" };
	}

	subscribe(listener: (pointId: QualifiedId) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Keys of contributions implemented in this process, by point. */
	localImplementations(): Record<string, QualifiedId[]> {
		const result: Record<string, QualifiedId[]> = {};
		for (const [pointId, records] of this.#records) {
			const keys = [...records.values()]
				.filter((record) => record.implementation !== undefined)
				.map((record) => record.key);
			if (keys.length > 0) result[pointId] = keys;
		}
		return result;
	}

	onLocalImplementationsChange(listener: () => void): () => void {
		this.#implementationListeners.add(listener);
		return () => this.#implementationListeners.delete(listener);
	}

	/** Records which contributions another process (`origin`) has implemented. */
	setRemoteImplementations(
		origin: string,
		implementations: Readonly<Record<string, readonly string[]>>,
	): void {
		const previous = this.#remote.get(origin);
		const next = new Map<QualifiedId, Set<QualifiedId>>();
		for (const [pointId, keys] of Object.entries(implementations)) {
			next.set(pointId as QualifiedId, new Set(keys as QualifiedId[]));
		}
		this.#remote.set(origin, next);
		const touched = new Set<QualifiedId>([...(previous?.keys() ?? []), ...next.keys()]);
		for (const pointId of touched) {
			if (!sameKeys(previous?.get(pointId), next.get(pointId))) this.#notify(pointId);
		}
	}

	clearRemoteImplementations(origin: string): void {
		const previous = this.#remote.get(origin);
		if (!previous) return;
		this.#remote.delete(origin);
		for (const pointId of previous.keys()) this.#notify(pointId);
	}

	async #answer(
		key: QualifiedId,
		handler: DecisionHandler<unknown>,
		input: unknown,
		spec: NonNullable<AnyExtensionPoint["decision"]>,
	): Promise<DecisionAnswer> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const timeout = new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new KernelError("TIMEOUT", `Decision handler "${key}" timed out.`)),
					spec.timeoutMs,
				);
			});
			return await Promise.race([Promise.resolve().then(() => handler(input)), timeout]);
		} catch (error) {
			this.#options.onDecisionError?.(key, error);
			return spec.failMode === "open" ? "proceed" : { reject: `Decision handler "${key}" failed.` };
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}

	#assertProcess(definition: AnyExtensionPoint): void {
		const process = definition.implementation?.process ?? "any";
		if (process !== "any" && process !== this.#options.process) {
			throw new KernelError(
				"VALIDATION",
				`Implementations for "${definition.id}" belong in the ${process} process.`,
			);
		}
	}

	#isRemotelyImplemented(pointId: QualifiedId, key: QualifiedId): boolean {
		for (const implementations of this.#remote.values()) {
			if (implementations.get(pointId)?.has(key)) return true;
		}
		return false;
	}

	#insert(record: ContributionRecord): void {
		const records = this.#records.get(record.pointId) ?? new Map();
		records.set(record.key, record);
		this.#records.set(record.pointId, records);
		this.#notify(record.pointId);
	}

	#view<TPoint extends AnyExtensionPoint>(
		record: ContributionRecord,
		implementedRemotely: boolean,
	): Contribution<TPoint> {
		return {
			key: record.key,
			pointId: record.pointId,
			pluginId: record.pluginId,
			id: record.id,
			priority: record.entry.priority,
			...(record.entry.when ? { when: record.entry.when } : {}),
			metadata: record.entry.metadata as MetadataOf<TPoint>,
			...(record.implementation === undefined
				? {}
				: { implementation: record.implementation as ImplementationOf<TPoint> }),
			implementedRemotely,
			source: record.source,
		};
	}

	#compare(a: Contribution, b: Contribution): number {
		if (a.priority !== b.priority) return b.priority - a.priority;
		const pluginDelta =
			this.#options.pluginOrder(a.pluginId) - this.#options.pluginOrder(b.pluginId);
		if (pluginDelta !== 0) return pluginDelta;
		const recordA = this.#records.get(a.pointId)?.get(a.key);
		const recordB = this.#records.get(b.pointId)?.get(b.key);
		return (recordA?.order ?? 0) - (recordB?.order ?? 0);
	}

	#notify(pointId: QualifiedId): void {
		for (const listener of [...this.#listeners]) listener(pointId);
	}

	#notifyImplementations(): void {
		for (const listener of [...this.#implementationListeners]) listener();
	}
}

function readsAny(records: Iterable<ContributionRecord>, keys: ReadonlySet<string>): boolean {
	for (const record of records) {
		if (whenKeys(record.entry.when).some((key) => keys.has(key))) return true;
	}
	return false;
}

function sameKeys(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): boolean {
	if ((a?.size ?? 0) !== (b?.size ?? 0)) return false;
	for (const key of a ?? []) if (!b?.has(key)) return false;
	return true;
}
