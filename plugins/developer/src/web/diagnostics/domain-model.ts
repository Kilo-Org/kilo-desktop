import {
	flagKey,
	type DomainObjectState,
	type ExtensionKind,
	type FlagRecord,
	type Kernel,
	type KernelDomainObjects,
	type MethodSpecs,
	type QualifiedId,
	type WhenExpression,
} from "@kilo-desktop/kernel";

import { formatEvent, formatMethod, formatType } from "./schema-format";

/**
 * The kernel's domain model — owners (plugins and the kernel), extension
 * points, domain objects, object types, context keys, flags and
 * contributions — as Diagnostics' inspector shows it, read from discovery
 * (what is declared), this window's registries (what is live here) and the
 * kernel's introspection objects (what main sees).
 */

/** Something the inspector can show; `owner` is a plugin or the kernel. */
export interface EntityRef {
	readonly kind: "owner" | "point" | "domain" | "objectType" | "contextKey" | "flag";
	readonly id: string;
}

export const ownerRef = (id: string): EntityRef => ({ kind: "owner", id });

export function sameEntity(a: EntityRef, b: EntityRef): boolean {
	return a.kind === b.kind && a.id === b.id;
}

/** The point, domain object, object type or context key a qualified id names, if one is declared. */
export function entityFor(kernel: Kernel, id: string): EntityRef | undefined {
	const { discovery } = kernel;
	if (discovery.extensionPoints.has(id as QualifiedId)) return { kind: "point", id };
	if (discovery.domainObjects.has(id as QualifiedId)) return { kind: "domain", id };
	if (discovery.objectTypes.has(id as QualifiedId)) return { kind: "objectType", id };
	if (discovery.contextKeys.some((key) => key.id === id)) return { kind: "contextKey", id };
	return undefined;
}

export interface Requirement {
	readonly pluginId: string;
	readonly need: "required" | "optional";
}

/** Plugins whose manifest `requires` the point or domain object. */
export function requiredBy(kernel: Kernel, id: string): Requirement[] {
	return kernel.discovery.plugins.flatMap(({ manifest }) => {
		const need = manifest.requires?.[id as QualifiedId];
		return need ? [{ pluginId: manifest.id, need }] : [];
	});
}

export type ContributionStatus =
	| "active"
	| "winner"
	| "fallback"
	| "failed"
	| "inactive"
	| "unimplemented"
	/** Or its plugin's state, when the plugin isn't running. */
	| (string & {});

export interface Condition {
	readonly key: string;
	readonly expected: boolean;
	readonly actual: boolean;
}

export interface ContributionView {
	readonly key: string;
	readonly pluginId: string;
	readonly id: string;
	readonly priority: number;
	readonly source: "manifest" | "runtime";
	readonly conditions: readonly Condition[];
	readonly metadata: unknown;
	readonly status: ContributionStatus;
	/** Where the implementation is bound; absent for points without implementations. */
	readonly implementedIn?: readonly string[];
}

export interface PointView {
	readonly id: string;
	readonly owner: string;
	readonly kind: ExtensionKind;
	readonly description?: string;
	readonly implementation?: {
		readonly process: "main" | "renderer" | "any";
		readonly required: boolean;
	};
	readonly decision?: {
		readonly failMode: "open" | "closed";
		readonly timeoutMs: number;
		readonly input: string;
	};
	/** Whether `${resources}` in contributions' metadata is replaced with the contributor's folder. */
	readonly resources: boolean;
	/** The metadata type, or undefined when contributions carry none of their own. */
	readonly metadata?: string;
	readonly contributions: readonly ContributionView[];
	readonly requiredBy: readonly Requirement[];
}

export type PluginStateOf = (pluginId: string) => string | undefined;

export function describePoint(
	kernel: Kernel,
	id: string,
	pluginState: PluginStateOf,
): PointView | undefined {
	const record = kernel.discovery.extensionPoints.get(id as QualifiedId);
	if (!record) return undefined;
	const { definition } = record;
	const metadata = formatType(definition.metadata);
	return {
		id,
		owner: record.owner,
		kind: definition.kind,
		...(definition.description ? { description: definition.description } : {}),
		...(definition.implementation
			? {
					implementation: {
						process: definition.implementation.process,
						required: definition.implementation.required,
					},
				}
			: {}),
		...(definition.decision
			? {
					decision: {
						failMode: definition.decision.failMode,
						timeoutMs: definition.decision.timeoutMs,
						input: formatType(definition.decision.input),
					},
				}
			: {}),
		resources: definition.resources ?? false,
		...(metadata === "{}" ? {} : { metadata }),
		contributions: contributionsTo(kernel, id as QualifiedId, pluginState),
		requiredBy: requiredBy(kernel, id),
	};
}

function contributionsTo(
	kernel: Kernel,
	pointId: QualifiedId,
	pluginState: PluginStateOf,
): ContributionView[] {
	const { extensions } = kernel;
	const definition = extensions.point(pointId).definition;
	const live = new Set(extensions.list(pointId).map((contribution) => contribution.key));
	const exclusive = definition.kind === "exclusive" ? extensions.exclusive(pointId) : undefined;
	const chain = new Set(exclusive?.chain.map((contribution) => contribution.key));

	const registered: ContributionView[] = extensions.all(pointId).map((contribution) => {
		const status: ContributionStatus = !live.has(contribution.key)
			? kernel.contextKeys.evaluate(contribution.when)
				? "unimplemented"
				: "inactive"
			: !exclusive
				? "active"
				: exclusive.winner?.key === contribution.key
					? "winner"
					: chain.has(contribution.key)
						? "fallback"
						: "failed";
		return {
			key: contribution.key,
			pluginId: contribution.pluginId,
			id: contribution.id,
			priority: contribution.priority,
			source: contribution.source,
			conditions: conditionsOf(kernel, contribution.when),
			metadata: contribution.metadata,
			status,
			...(definition.implementation
				? {
						implementedIn: [
							...(contribution.implementation === undefined ? [] : ["this window"]),
							...extensions.implementationOrigins(pointId, contribution.key).map(describeOrigin),
						],
					}
				: {}),
		};
	});

	// Manifest contributions of plugins that aren't running here aren't registered.
	const keys = new Set(registered.map((contribution) => contribution.key));
	const unregistered: ContributionView[] = kernel.discovery.contributions
		.filter(
			(contribution) =>
				contribution.pointId === pointId &&
				!keys.has(`${contribution.pluginId}/${contribution.entry.id}`),
		)
		.map(({ pluginId, entry }) => {
			const state = pluginState(pluginId);
			return {
				key: `${pluginId}/${entry.id}`,
				pluginId,
				id: entry.id,
				priority: entry.priority,
				source: "manifest",
				conditions: conditionsOf(kernel, entry.when),
				metadata: entry.metadata,
				status: state && state !== "active" ? state : "not registered",
			};
		});
	return [...registered, ...unregistered];
}

function describeOrigin(origin: string): string {
	return origin === "main" ? "the main process" : "another window";
}

export function conditionsOf(kernel: Kernel, when: WhenExpression | undefined): Condition[] {
	const condition = (key: string, expected: boolean): Condition => ({
		key,
		expected,
		actual: kernel.contextKeys.get(key),
	});
	return [
		...(when?.all ?? []).map((key) => condition(key, true)),
		...(when?.none ?? []).map((key) => condition(key, false)),
	];
}

/** What main reports about domain objects (`kernel/domain-objects`), when this window sees it. */
export type MainDomainObjects = DomainObjectState<typeof KernelDomainObjects>["domainObjects"];

/**
 * Provided right now: a main-home object as main reports it (falling back to
 * this window's mirror), a renderer-home object in this window.
 */
function isProvided(
	kernel: Kernel,
	id: QualifiedId,
	home: "main" | "renderer",
	main: MainDomainObjects | undefined,
): boolean {
	const reported = home === "main" ? main?.[id]?.provided : undefined;
	return reported ?? kernel.domainObjects.isProvided(id);
}

export interface DomainView {
	readonly id: string;
	readonly owner: string;
	readonly home: "main" | "renderer";
	readonly description?: string;
	readonly permission?: string;
	readonly homeCallersOnly: boolean;
	readonly hasLookup: boolean;
	/** The object type it resolves, for a collection. */
	readonly objectType?: string;
	/** Provided right now: main-home as main reports it, renderer-home in this window. */
	readonly provided: boolean;
	readonly state: string;
	readonly methods: readonly string[];
	readonly events: readonly string[];
	readonly requiredBy: readonly Requirement[];
}

export function describeDomain(
	kernel: Kernel,
	id: string,
	main?: MainDomainObjects,
): DomainView | undefined {
	const record = kernel.discovery.domainObjects.get(id as QualifiedId);
	if (!record) return undefined;
	const { definition } = record;
	return {
		id,
		owner: record.owner,
		home: definition.home,
		...(definition.description ? { description: definition.description } : {}),
		...(definition.permission ? { permission: definition.permission } : {}),
		homeCallersOnly: definition.homeCallersOnly ?? false,
		hasLookup: definition.lookup !== undefined,
		...(definition.objectType ? { objectType: definition.objectType.id } : {}),
		provided: isProvided(kernel, definition.id, definition.home, main),
		state: formatType(definition.state),
		methods: Object.entries(definition.methods as MethodSpecs).map(([name, spec]) =>
			formatMethod(name, spec),
		),
		events: Object.entries(definition.events).map(([name, payload]) => formatEvent(name, payload)),
		requiredBy: requiredBy(kernel, id),
	};
}

export interface PointEntry {
	readonly id: string;
	readonly owner: string;
	readonly kind: ExtensionKind;
	readonly description?: string;
	/** Contributions declared in manifests. */
	readonly contributions: number;
}

export interface DomainEntry {
	readonly id: string;
	readonly owner: string;
	readonly home: "main" | "renderer";
	readonly description?: string;
	readonly provided: boolean;
}

const byId = (a: { readonly id: string }, b: { readonly id: string }) => a.id.localeCompare(b.id);

export function listPoints(kernel: Kernel): PointEntry[] {
	const counts = new Map<string, number>();
	for (const { pointId } of kernel.discovery.contributions) {
		counts.set(pointId, (counts.get(pointId) ?? 0) + 1);
	}
	return [...kernel.discovery.extensionPoints.values()]
		.map(({ owner, definition }) => ({
			id: definition.id,
			owner,
			kind: definition.kind,
			...(definition.description ? { description: definition.description } : {}),
			contributions: counts.get(definition.id) ?? 0,
		}))
		.sort(byId);
}

export function listDomains(kernel: Kernel, main?: MainDomainObjects): DomainEntry[] {
	return [...kernel.discovery.domainObjects.values()]
		.map(({ owner, definition }) => ({
			id: definition.id,
			owner,
			home: definition.home,
			...(definition.description ? { description: definition.description } : {}),
			provided: isProvided(kernel, definition.id, definition.home, main),
		}))
		.sort(byId);
}

// --- Object types ---

export interface ObjectTypeView {
	readonly id: string;
	readonly owner: string;
	readonly description?: string;
	/** The collection that resolves references of this type. */
	readonly collection?: string;
	/** Whether that collection is provided right now. */
	readonly provided: boolean;
}

function objectTypeView(
	kernel: Kernel,
	record: { owner: string; definition: { id: string; description?: string }; collection?: string },
	main: MainDomainObjects | undefined,
): ObjectTypeView {
	const collection = record.collection as QualifiedId | undefined;
	const home = collection && kernel.discovery.domainObjects.get(collection)?.definition.home;
	return {
		id: record.definition.id,
		owner: record.owner,
		...(record.definition.description ? { description: record.definition.description } : {}),
		...(collection ? { collection } : {}),
		provided: collection && home ? isProvided(kernel, collection, home, main) : false,
	};
}

export function listObjectTypes(kernel: Kernel, main?: MainDomainObjects): ObjectTypeView[] {
	return [...kernel.discovery.objectTypes.values()]
		.map((record) => objectTypeView(kernel, record, main))
		.sort(byId);
}

export function describeObjectType(
	kernel: Kernel,
	id: string,
	main?: MainDomainObjects,
): ObjectTypeView | undefined {
	const record = kernel.discovery.objectTypes.get(id as QualifiedId);
	return record ? objectTypeView(kernel, record, main) : undefined;
}

// --- Context keys ---

/** A plugin or contribution whose `when` reads a context key. */
export interface KeyUse {
	readonly pluginId: string;
	/** Absent for the plugin's own `when`; the contribution key otherwise. */
	readonly contribution?: string;
	readonly pointId?: string;
	readonly key: string;
	readonly expected: boolean;
}

export interface ContextKeyView {
	readonly id: string;
	readonly owner: string;
	readonly scope: "global" | "window";
	readonly description?: string;
	/** A family of keys (`kernel/flag:*`) rather than one key. */
	readonly pattern: boolean;
	/** The keys set in this window that the entry names, with their values. */
	readonly values: readonly { readonly key: string; readonly value: boolean }[];
}

const isPattern = (id: string) => id.endsWith("*");

/** Whether context key `key` is named by the declared `id` (exactly, or by its `*` pattern). */
export function keyMatches(id: string, key: string): boolean {
	return isPattern(id) ? key.startsWith(id.slice(0, -1)) : id === key;
}

function contextKeyView(
	kernel: Kernel,
	record: { id: string; owner: string; scope: "global" | "window"; description?: string },
): ContextKeyView {
	const pattern = isPattern(record.id);
	const set = kernel.contextKeys.snapshot();
	const values = pattern
		? Object.keys(set)
				.filter((key) => keyMatches(record.id, key))
				.sort()
				.map((key) => ({ key, value: set[key] ?? false }))
		: [{ key: record.id, value: kernel.contextKeys.get(record.id) }];
	return {
		id: record.id,
		owner: record.owner,
		scope: record.scope,
		...(record.description ? { description: record.description } : {}),
		pattern,
		values,
	};
}

export function listContextKeys(kernel: Kernel): ContextKeyView[] {
	return kernel.discovery.contextKeys.map((record) => contextKeyView(kernel, record)).sort(byId);
}

export function describeContextKey(kernel: Kernel, id: string): ContextKeyView | undefined {
	const record = kernel.discovery.contextKeys.find((candidate) => candidate.id === id);
	return record ? contextKeyView(kernel, record) : undefined;
}

/** Plugins and manifest contributions whose `when` reads a key the declared `id` names. */
export function usesOf(kernel: Kernel, id: string): KeyUse[] {
	const uses = (
		when: WhenExpression | undefined,
		where: Omit<KeyUse, "key" | "expected">,
	): KeyUse[] => [
		...(when?.all ?? [])
			.filter((key) => keyMatches(id, key))
			.map((key) => ({ ...where, key, expected: true })),
		...(when?.none ?? [])
			.filter((key) => keyMatches(id, key))
			.map((key) => ({ ...where, key, expected: false })),
	];
	return [
		...kernel.discovery.plugins.flatMap(({ manifest }) =>
			uses(manifest.when, { pluginId: manifest.id }),
		),
		...kernel.discovery.contributions.flatMap(({ pluginId, pointId, entry }) =>
			uses(entry.when, { pluginId, pointId, contribution: `${pluginId}/${entry.id}` }),
		),
	];
}

// --- Flags ---

export interface FlagView extends FlagRecord {
	readonly id: string;
	/** `kernel/flag:<id>`, true while the value is `true`. */
	readonly contextKey: string;
	/** What runs only while (or unless) the flag is on. */
	readonly gates: readonly KeyUse[];
}

export function listFlags(
	flags: Readonly<Record<string, FlagRecord>>,
): (FlagRecord & { id: string })[] {
	return Object.entries(flags)
		.map(([id, record]) => ({ id, ...record }))
		.sort(byId);
}

export function describeFlag(
	kernel: Kernel,
	id: string,
	flags: Readonly<Record<string, FlagRecord>> | undefined,
): FlagView | undefined {
	const record = flags?.[id];
	if (!record) return undefined;
	const contextKey = flagKey(id);
	return { id, ...record, contextKey, gates: usesOf(kernel, contextKey) };
}

/** Case-insensitive match on id, owner or description. */
export function matches(
	entry: { readonly id: string; readonly owner: string; readonly description?: string },
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === "") return true;
	return [entry.id, entry.owner, entry.description ?? ""].some((text) =>
		text.toLowerCase().includes(needle),
	);
}
