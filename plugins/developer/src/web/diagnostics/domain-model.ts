import {
	type ExtensionKind,
	type Kernel,
	type MethodSpecs,
	type QualifiedId,
	type WhenExpression,
} from "@kilo-desktop/kernel";

import { formatEvent, formatMethod, formatType } from "./schema-format";

/**
 * The kernel's domain model — owners (plugins and the kernel), extension
 * points, domain objects and contributions — as Diagnostics' inspector shows
 * it, read from discovery (what is declared) and this window's registries
 * (what is live here).
 */

/** Something the inspector can show; `owner` is a plugin or the kernel. */
export interface EntityRef {
	readonly kind: "owner" | "point" | "domain";
	readonly id: string;
}

export const ownerRef = (id: string): EntityRef => ({ kind: "owner", id });

export function sameEntity(a: EntityRef, b: EntityRef): boolean {
	return a.kind === b.kind && a.id === b.id;
}

/** The point or domain object a qualified id names, if one is declared. */
export function entityFor(kernel: Kernel, id: string): EntityRef | undefined {
	if (kernel.discovery.points.has(id as QualifiedId)) return { kind: "point", id };
	if (kernel.discovery.domains.has(id as QualifiedId)) return { kind: "domain", id };
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
	const record = kernel.discovery.points.get(id as QualifiedId);
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

function conditionsOf(kernel: Kernel, when: WhenExpression | undefined): Condition[] {
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

export interface DomainView {
	readonly id: string;
	readonly owner: string;
	readonly home: "main" | "renderer";
	readonly description?: string;
	readonly permission?: string;
	readonly homeCallersOnly: boolean;
	readonly resolvesRefs: boolean;
	/** Provided right now, as seen from this window. */
	readonly provided: boolean;
	readonly state: string;
	readonly methods: readonly string[];
	readonly events: readonly string[];
	readonly requiredBy: readonly Requirement[];
}

export function describeDomain(kernel: Kernel, id: string): DomainView | undefined {
	const record = kernel.discovery.domains.get(id as QualifiedId);
	if (!record) return undefined;
	const { definition } = record;
	return {
		id,
		owner: record.owner,
		home: definition.home,
		...(definition.description ? { description: definition.description } : {}),
		...(definition.permission ? { permission: definition.permission } : {}),
		homeCallersOnly: definition.homeCallersOnly ?? false,
		resolvesRefs: definition.lookup !== undefined,
		provided: kernel.domains.isProvided(id as QualifiedId),
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
	return [...kernel.discovery.points.values()]
		.map(({ owner, definition }) => ({
			id: definition.id,
			owner,
			kind: definition.kind,
			...(definition.description ? { description: definition.description } : {}),
			contributions: counts.get(definition.id) ?? 0,
		}))
		.sort(byId);
}

export function listDomains(kernel: Kernel): DomainEntry[] {
	return [...kernel.discovery.domains.values()]
		.map(({ owner, definition }) => ({
			id: definition.id,
			owner,
			home: definition.home,
			...(definition.description ? { description: definition.description } : {}),
			provided: kernel.domains.isProvided(definition.id),
		}))
		.sort(byId);
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
