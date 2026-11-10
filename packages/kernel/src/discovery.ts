import type { AnyDomainObject } from "./domain-object";
import type { AnyExtensionPoint } from "./extension-point";
import { KERNEL_OWNER, ownerOf, qualify, type QualifiedId } from "./ids";
import { manifestSchema, type PluginManifest } from "./manifest";
import type { ObjectTypeDefinition } from "./object-type";
import type { PluginDefinitions, PluginEntry, PluginRegistration } from "./plugin";
import { whenKeys, whenSchema, type WhenExpression } from "./when";

export type IssueSeverity = "error" | "warning";

export interface KernelIssue {
	readonly severity: IssueSeverity;
	readonly code: string;
	readonly message: string;
	readonly pluginId?: string;
}

export type DiscoveryStatus = "resolved" | "unresolved";

export interface DiscoveredPlugin {
	readonly manifest: PluginManifest;
	readonly definitions: PluginDefinitions;
	readonly entry?: PluginEntry;
	readonly status: DiscoveryStatus;
	readonly unresolvedReasons: readonly string[];
}

export interface ExtensionPointRecord {
	readonly owner: string;
	readonly definition: AnyExtensionPoint;
}

export interface DomainObjectRecord {
	readonly owner: string;
	readonly definition: AnyDomainObject;
}

export interface ObjectTypeRecord {
	readonly owner: string;
	readonly definition: ObjectTypeDefinition;
	/** The collection domain object that resolves references of this type, if any. */
	readonly collection?: QualifiedId;
}

export interface ParsedContributionEntry {
	readonly id: string;
	readonly priority: number;
	readonly when?: WhenExpression;
	readonly metadata: unknown;
}

export interface DiscoveredContribution {
	readonly pointId: QualifiedId;
	readonly pluginId: string;
	readonly entry: ParsedContributionEntry;
}

export interface ContextKeyRecord {
	readonly id: QualifiedId;
	readonly owner: string;
	readonly scope: "global" | "window";
	readonly description?: string;
}

export interface DiscoveryResult {
	/** Valid plugins in activation order. */
	readonly plugins: readonly DiscoveredPlugin[];
	readonly extensionPoints: ReadonlyMap<QualifiedId, ExtensionPointRecord>;
	readonly domainObjects: ReadonlyMap<QualifiedId, DomainObjectRecord>;
	readonly objectTypes: ReadonlyMap<QualifiedId, ObjectTypeRecord>;
	readonly contextKeys: readonly ContextKeyRecord[];
	readonly contributions: readonly DiscoveredContribution[];
	readonly issues: readonly KernelIssue[];
}

export interface DiscoveryOptions {
	/** Extension points, domain objects and context keys owned by the kernel itself. */
	readonly kernelDefinitions?: PluginDefinitions;
	readonly kernelContextKeys?: readonly ContextKeyRecord[];
}

const RESERVED_BUNDLED_PUBLISHER = "kilo";
const COMMON_FIELDS = new Set(["id", "priority", "when"]);

interface Candidate {
	readonly manifest: PluginManifest;
	readonly registration: PluginRegistration;
}

/**
 * Validates manifests and contracts, applies namespacing rules, validates
 * contribution metadata against each point's schema, and orders plugins after
 * the owners of what they require. Never throws: problems become issues and
 * the offending plugin or contribution is skipped.
 */
export function discoverPlugins(
	registrations: readonly PluginRegistration[],
	options: DiscoveryOptions = {},
): DiscoveryResult {
	const issues: KernelIssue[] = [];
	const candidates = validateManifests(registrations, issues);

	const records: DefinitionRecords = {
		extensionPoints: new Map(),
		domainObjects: new Map(),
		objectTypes: new Map(),
	};
	const kernel = options.kernelDefinitions;
	for (const definition of kernel?.extensionPoints ?? []) {
		records.extensionPoints.set(definition.id, { owner: KERNEL_OWNER, definition });
	}
	for (const definition of kernel?.objectTypes ?? []) {
		records.objectTypes.set(definition.id, { owner: KERNEL_OWNER, definition });
	}
	for (const definition of kernel?.domainObjects ?? []) {
		records.domainObjects.set(definition.id, { owner: KERNEL_OWNER, definition });
		const type = definition.objectType && records.objectTypes.get(definition.objectType.id);
		if (type) records.objectTypes.set(type.definition.id, { ...type, collection: definition.id });
	}
	for (const candidate of candidates) collectDefinitions(candidate, records, issues);
	const { extensionPoints, domainObjects, objectTypes } = records;

	const contextKeys = collectContextKeys(candidates, options.kernelContextKeys ?? []);
	const contributions = collectContributions(candidates, extensionPoints, contextKeys, issues);
	const plugins = orderAndResolve(candidates, extensionPoints, domainObjects, issues);

	return {
		plugins,
		extensionPoints,
		domainObjects,
		objectTypes,
		contextKeys,
		contributions,
		issues,
	};
}

function validateManifests(
	registrations: readonly PluginRegistration[],
	issues: KernelIssue[],
): Candidate[] {
	const seen = new Set<string>();
	const candidates: Candidate[] = [];
	for (const registration of registrations) {
		const parsed = manifestSchema.safeParse(registration.manifest);
		if (!parsed.success) {
			const rawId = (registration.manifest as { id?: unknown } | null)?.id;
			issues.push({
				severity: "error",
				code: "invalid-manifest",
				message: `Invalid plugin manifest: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
				...(typeof rawId === "string" ? { pluginId: rawId } : {}),
			});
			continue;
		}
		const manifest = parsed.data;
		if (seen.has(manifest.id)) {
			issues.push({
				severity: "error",
				code: "duplicate-plugin",
				message: `A plugin with id "${manifest.id}" is already registered.`,
				pluginId: manifest.id,
			});
			continue;
		}
		if (
			registration.source === "external" &&
			manifest.id.split(".")[0] === RESERVED_BUNDLED_PUBLISHER
		) {
			issues.push({
				severity: "error",
				code: "reserved-publisher",
				message: `The "${RESERVED_BUNDLED_PUBLISHER}." publisher is reserved for bundled plugins.`,
				pluginId: manifest.id,
			});
			continue;
		}
		seen.add(manifest.id);
		candidates.push({ manifest, registration });
	}
	return candidates;
}

interface DefinitionRecords {
	readonly extensionPoints: Map<QualifiedId, ExtensionPointRecord>;
	readonly domainObjects: Map<QualifiedId, DomainObjectRecord>;
	readonly objectTypes: Map<QualifiedId, ObjectTypeRecord>;
}

/**
 * Pairs what a manifest declares with what its contracts define, by id.
 * A definition outside the plugin's namespace, a declaration with no
 * definition and a definition with no declaration are each reported.
 */
function pairDeclarations<TDeclared, TDefinition extends { readonly id: QualifiedId }>(
	pluginId: string,
	what: { readonly label: string; readonly code: string },
	declared: readonly (TDeclared & { readonly id: string })[],
	defined: readonly TDefinition[],
	issue: (code: string, message: string) => void,
): [QualifiedId, TDeclared, TDefinition][] {
	const declarations = new Map(declared.map((entry) => [qualify(pluginId, entry.id), entry]));
	const definitions = new Map<QualifiedId, TDefinition>();
	for (const definition of defined) {
		if (ownerOf(definition.id) !== pluginId) {
			issue(
				"foreign-definition",
				`${what.label} "${definition.id}" is outside the "${pluginId}" namespace.`,
			);
		} else {
			definitions.set(definition.id, definition);
		}
	}
	const pairs: [QualifiedId, TDeclared, TDefinition][] = [];
	for (const [id, declaration] of declarations) {
		const definition = definitions.get(id);
		if (definition) pairs.push([id, declaration, definition]);
		else issue(`undefined-${what.code}`, `${what.label} "${id}" has no definition in contracts.`);
	}
	for (const id of definitions.keys()) {
		if (!declarations.has(id)) {
			issue(`undeclared-${what.code}`, `${what.label} "${id}" is not declared in plugin.json.`);
		}
	}
	return pairs;
}

function collectDefinitions(
	{ manifest, registration }: Candidate,
	records: DefinitionRecords,
	issues: KernelIssue[],
): void {
	const pluginId = manifest.id;
	const definitions = registration.definitions ?? {};
	const issue = (code: string, message: string) =>
		issues.push({ severity: "error", code, message, pluginId });

	const ids = [
		...(manifest.extensionPoints ?? []),
		...(manifest.domainObjects ?? []),
		...(manifest.contextKeys ?? []),
		...(manifest.objectTypes ?? []),
	].map((entry) => qualify(pluginId, entry.id));
	for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) {
		issue(
			"duplicate-id",
			`"${id}" names more than one extension point, domain object, context key or object type.`,
		);
	}

	for (const [id, declared, definition] of pairDeclarations(
		pluginId,
		{ label: "Extension point", code: "extension-point" },
		manifest.extensionPoints ?? [],
		definitions.extensionPoints ?? [],
		issue,
	)) {
		if (definition.kind !== declared.kind) {
			issue(
				"kind-mismatch",
				`Extension point "${id}" is declared "${declared.kind}" but defined "${definition.kind}".`,
			);
		} else {
			records.extensionPoints.set(id, { owner: pluginId, definition });
		}
	}

	for (const [id, , definition] of pairDeclarations(
		pluginId,
		{ label: "Object type", code: "object-type" },
		manifest.objectTypes ?? [],
		definitions.objectTypes ?? [],
		issue,
	)) {
		records.objectTypes.set(id, { owner: pluginId, definition });
	}

	for (const [id, declared, definition] of pairDeclarations(
		pluginId,
		{ label: "Domain object", code: "domain-object" },
		manifest.domainObjects ?? [],
		definitions.domainObjects ?? [],
		issue,
	)) {
		const problem = collectionProblem(id, declared.objectType, definition, records.objectTypes);
		if (definition.home !== declared.home) {
			issue(
				"home-mismatch",
				`Domain object "${id}" is declared home "${declared.home}" but defined "${definition.home}".`,
			);
		} else if (problem) {
			issue(problem.code, problem.message);
		} else {
			records.domainObjects.set(id, { owner: pluginId, definition });
			const type = definition.objectType && records.objectTypes.get(definition.objectType.id);
			if (type) records.objectTypes.set(type.definition.id, { ...type, collection: id });
		}
	}
}

/** Checks the object type a collection resolves: declared alike, owned by its plugin, resolved once. */
function collectionProblem(
	id: QualifiedId,
	declared: string | undefined,
	definition: AnyDomainObject,
	objectTypes: ReadonlyMap<QualifiedId, ObjectTypeRecord>,
): { readonly code: string; readonly message: string } | undefined {
	const defined = definition.objectType?.id;
	if (declared !== defined) {
		return {
			code: "object-type-mismatch",
			message: `Domain object "${id}" is declared to resolve "${declared ?? "nothing"}" but defined to resolve "${defined ?? "nothing"}".`,
		};
	}
	if (defined === undefined) return undefined;
	const type = objectTypes.get(defined);
	if (!type || type.owner !== ownerOf(id)) {
		return {
			code: "foreign-object-type",
			message: `Domain object "${id}" resolves "${defined}", which is not an object type of its plugin.`,
		};
	}
	if (type.collection !== undefined) {
		return {
			code: "duplicate-collection",
			message: `Object type "${defined}" is already resolved by "${type.collection}".`,
		};
	}
	if (!definition.lookup) {
		return {
			code: "missing-lookup",
			message: `Domain object "${id}" resolves "${defined}" but declares no lookup.`,
		};
	}
	return undefined;
}

function collectContextKeys(
	candidates: readonly Candidate[],
	kernelKeys: readonly ContextKeyRecord[],
): ContextKeyRecord[] {
	const keys = [...kernelKeys];
	for (const { manifest } of candidates) {
		for (const key of manifest.contextKeys ?? []) {
			keys.push({
				id: qualify(manifest.id, key.id),
				owner: manifest.id,
				scope: key.scope,
				...(key.description === undefined ? {} : { description: key.description }),
			});
		}
	}
	return keys;
}

function isKnownContextKey(key: string, keys: readonly ContextKeyRecord[]): boolean {
	return keys.some((record) =>
		record.id.endsWith("*") ? key.startsWith(record.id.slice(0, -1)) : record.id === key,
	);
}

function collectContributions(
	candidates: readonly Candidate[],
	points: ReadonlyMap<QualifiedId, ExtensionPointRecord>,
	contextKeys: readonly ContextKeyRecord[],
	issues: KernelIssue[],
): DiscoveredContribution[] {
	const contributions: DiscoveredContribution[] = [];
	const installed = new Set<string>([
		KERNEL_OWNER,
		...candidates.map(({ manifest }) => manifest.id),
	]);
	for (const { manifest } of candidates) {
		const pluginId = manifest.id;
		for (const [pointId, entries] of Object.entries(manifest.contributes?.extensions ?? {})) {
			const point = points.get(pointId as QualifiedId);
			if (!point) {
				issues.push(unknownPointIssue(pointId, pluginId, installed));
				continue;
			}
			const seenIds = new Set<string>();
			for (const raw of entries) {
				const parsed = parseContributionEntry(raw, point.definition);
				if (!parsed.ok) {
					issues.push({
						severity: "error",
						code: "invalid-contribution",
						message: `Invalid contribution to "${pointId}": ${parsed.message}`,
						pluginId,
					});
					continue;
				}
				if (seenIds.has(parsed.entry.id)) {
					issues.push({
						severity: "error",
						code: "duplicate-contribution",
						message: `Duplicate contribution id "${parsed.entry.id}" to "${pointId}".`,
						pluginId,
					});
					continue;
				}
				seenIds.add(parsed.entry.id);
				for (const key of whenKeys(parsed.entry.when)) {
					if (!isKnownContextKey(key, contextKeys)) {
						issues.push({
							severity: "warning",
							code: "unknown-context-key",
							message: `Contribution "${parsed.entry.id}" to "${pointId}" uses undeclared context key "${key}"; it evaluates to false.`,
							pluginId,
						});
					}
				}
				contributions.push({ pointId: point.definition.id, pluginId, entry: parsed.entry });
			}
		}
	}
	return contributions;
}

/**
 * A point owned by a plugin that isn't installed is an optional integration
 * that doesn't apply, so it only warns; a point missing from an installed
 * owner (or the kernel) is a mistake.
 */
function unknownPointIssue(
	pointId: string,
	pluginId: string,
	installed: ReadonlySet<string>,
): KernelIssue {
	const owner = pointId.includes("/") ? pointId.slice(0, pointId.indexOf("/")) : undefined;
	if (owner && !installed.has(owner)) {
		return {
			severity: "warning",
			code: "absent-extension-point-owner",
			message: `Contributions to "${pointId}" are ignored: "${owner}" is not installed.`,
			pluginId,
		};
	}
	return {
		severity: "error",
		code: "unknown-extension-point",
		message: `Contributions target unknown extension point "${pointId}".`,
		pluginId,
	};
}

type ParseResult =
	| { readonly ok: true; readonly entry: ParsedContributionEntry }
	| { readonly ok: false; readonly message: string };

/** Splits the common fields from the point's metadata and validates both. */
export function parseContributionEntry(
	raw: Readonly<Record<string, unknown>>,
	point: AnyExtensionPoint,
): ParseResult {
	const { id, priority, when } = raw;
	if (typeof id !== "string" || id.length === 0) {
		return { ok: false, message: "Every contribution needs a non-empty string id." };
	}
	if (priority !== undefined && (typeof priority !== "number" || !Number.isFinite(priority))) {
		return { ok: false, message: `"${id}": priority must be a finite number.` };
	}
	let parsedWhen: WhenExpression | undefined;
	if (when !== undefined) {
		const result = whenSchema.safeParse(when);
		if (!result.success) return { ok: false, message: `"${id}": invalid when condition.` };
		parsedWhen = {
			...(result.data.all ? { all: result.data.all } : {}),
			...(result.data.none ? { none: result.data.none } : {}),
		};
	}
	const metadataInput: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (!COMMON_FIELDS.has(key)) metadataInput[key] = value;
	}
	const metadata = point.metadata.safeParse(metadataInput);
	if (!metadata.success) {
		return {
			ok: false,
			message: `"${id}": ${metadata.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`,
		};
	}
	return {
		ok: true,
		entry: {
			id,
			priority: (priority as number | undefined) ?? 0,
			...(parsedWhen === undefined ? {} : { when: parsedWhen }),
			metadata: metadata.data,
		},
	};
}

function orderAndResolve(
	candidates: readonly Candidate[],
	points: ReadonlyMap<QualifiedId, ExtensionPointRecord>,
	domainObjects: ReadonlyMap<QualifiedId, DomainObjectRecord>,
	issues: KernelIssue[],
): DiscoveredPlugin[] {
	const ownerOfItem = (id: QualifiedId): string | undefined =>
		points.get(id)?.owner ?? domainObjects.get(id)?.owner;

	const byId = new Map(candidates.map((candidate) => [candidate.manifest.id, candidate]));
	const reasons = new Map<string, string[]>();
	const dependencies = new Map<string, Set<string>>();

	for (const { manifest } of candidates) {
		const deps = new Set<string>();
		for (const [item, strength] of Object.entries(manifest.requires ?? {})) {
			const owner = ownerOfItem(item as QualifiedId);
			if (owner === undefined) {
				if (strength === "required") {
					addReason(reasons, manifest.id, `Requires "${item}", which is not available.`);
				}
				continue;
			}
			if (owner === KERNEL_OWNER || owner === manifest.id) continue;
			if (byId.has(owner)) deps.add(owner);
			if (strength === "required") deps.add(`required:${owner}`);
		}
		dependencies.set(manifest.id, deps);
	}

	const ordered = topologicalOrder(candidates, dependencies, issues, reasons);

	// Propagate: requiring an unresolved plugin's items makes you unresolved.
	for (const id of ordered) {
		for (const dep of dependencies.get(id) ?? []) {
			if (!dep.startsWith("required:")) continue;
			const owner = dep.slice("required:".length);
			if (reasons.has(owner) && !reasons.has(id)) {
				addReason(reasons, id, `Requires items from "${owner}", which is unresolved.`);
			}
		}
	}

	return ordered.map((id) => {
		const { manifest, registration } = byId.get(id)!;
		const unresolvedReasons = reasons.get(id) ?? [];
		return {
			manifest,
			definitions: registration.definitions ?? {},
			...(registration.entry ? { entry: registration.entry } : {}),
			status: unresolvedReasons.length > 0 ? "unresolved" : "resolved",
			unresolvedReasons,
		};
	});
}

function addReason(reasons: Map<string, string[]>, id: string, reason: string): void {
	const list = reasons.get(id) ?? [];
	list.push(reason);
	reasons.set(id, list);
}

/** Stable topological order (registration order among independents); cycles become unresolved. */
function topologicalOrder(
	candidates: readonly Candidate[],
	dependencies: ReadonlyMap<string, Set<string>>,
	issues: KernelIssue[],
	reasons: Map<string, string[]>,
): string[] {
	const ids = candidates.map((candidate) => candidate.manifest.id);
	const depsOf = (id: string) =>
		[...(dependencies.get(id) ?? [])].filter((dep) => !dep.startsWith("required:"));
	const ordered: string[] = [];
	const placed = new Set<string>();

	let progress = true;
	while (progress && placed.size < ids.length) {
		progress = false;
		for (const id of ids) {
			if (placed.has(id)) continue;
			if (depsOf(id).every((dep) => placed.has(dep))) {
				ordered.push(id);
				placed.add(id);
				progress = true;
				break;
			}
		}
	}
	for (const id of ids) {
		if (placed.has(id)) continue;
		issues.push({
			severity: "error",
			code: "requires-cycle",
			message: `"${id}" is part of a requires cycle.`,
			pluginId: id,
		});
		addReason(reasons, id, "Part of a requires cycle.");
		ordered.push(id);
	}
	return ordered;
}
