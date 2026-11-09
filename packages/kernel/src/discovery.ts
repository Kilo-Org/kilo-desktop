import type { AnyDomain } from "./domain";
import type { AnyExtensionPoint } from "./extension-point";
import { KERNEL_OWNER, ownerOf, qualify, type QualifiedId } from "./ids";
import { manifestSchema, type PluginManifest } from "./manifest";
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

export interface PointRecord {
	readonly owner: string;
	readonly definition: AnyExtensionPoint;
}

export interface DomainRecord {
	readonly owner: string;
	readonly definition: AnyDomain;
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
}

export interface DiscoveryResult {
	/** Valid plugins in activation order. */
	readonly plugins: readonly DiscoveredPlugin[];
	readonly points: ReadonlyMap<QualifiedId, PointRecord>;
	readonly domains: ReadonlyMap<QualifiedId, DomainRecord>;
	readonly contextKeys: readonly ContextKeyRecord[];
	readonly contributions: readonly DiscoveredContribution[];
	readonly issues: readonly KernelIssue[];
}

export interface DiscoveryOptions {
	/** Points, domains and context keys owned by the kernel itself. */
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

	const points = new Map<QualifiedId, PointRecord>();
	const domains = new Map<QualifiedId, DomainRecord>();
	for (const point of options.kernelDefinitions?.extensionPoints ?? []) {
		points.set(point.id, { owner: KERNEL_OWNER, definition: point });
	}
	for (const domain of options.kernelDefinitions?.domains ?? []) {
		domains.set(domain.id, { owner: KERNEL_OWNER, definition: domain });
	}
	for (const candidate of candidates) {
		collectDefinitions(candidate, points, domains, issues);
	}

	const contextKeys = collectContextKeys(candidates, options.kernelContextKeys ?? []);
	const contributions = collectContributions(candidates, points, contextKeys, issues);
	const plugins = orderAndResolve(candidates, points, domains, issues);

	return { plugins, points, domains, contextKeys, contributions, issues };
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

function collectDefinitions(
	{ manifest, registration }: Candidate,
	points: Map<QualifiedId, PointRecord>,
	domains: Map<QualifiedId, DomainRecord>,
	issues: KernelIssue[],
): void {
	const pluginId = manifest.id;
	const issue = (code: string, message: string) =>
		issues.push({ severity: "error", code, message, pluginId });

	const declaredPoints = new Map(
		(manifest.extensionPoints ?? []).map((point) => [qualify(pluginId, point.id), point]),
	);
	const definedPoints = new Map<QualifiedId, AnyExtensionPoint>();
	for (const definition of registration.definitions?.extensionPoints ?? []) {
		if (ownerOf(definition.id) !== pluginId) {
			issue(
				"foreign-definition",
				`Extension point "${definition.id}" is outside the "${pluginId}" namespace.`,
			);
			continue;
		}
		definedPoints.set(definition.id, definition);
	}
	for (const [id, declared] of declaredPoints) {
		const definition = definedPoints.get(id);
		if (!definition) {
			issue("undefined-extension-point", `Extension point "${id}" has no definition in contracts.`);
		} else if (definition.kind !== declared.kind) {
			issue(
				"kind-mismatch",
				`Extension point "${id}" is declared "${declared.kind}" but defined "${definition.kind}".`,
			);
		} else {
			points.set(id, { owner: pluginId, definition });
		}
	}
	for (const id of definedPoints.keys()) {
		if (!declaredPoints.has(id)) {
			issue(
				"undeclared-extension-point",
				`Extension point "${id}" is not declared in plugin.json.`,
			);
		}
	}

	const declaredDomains = new Map(
		(manifest.domains ?? []).map((domain) => [qualify(pluginId, domain.id), domain]),
	);
	const definedDomains = new Map<QualifiedId, AnyDomain>();
	for (const definition of registration.definitions?.domains ?? []) {
		if (ownerOf(definition.id) !== pluginId) {
			issue(
				"foreign-definition",
				`Domain object "${definition.id}" is outside the "${pluginId}" namespace.`,
			);
			continue;
		}
		definedDomains.set(definition.id, definition);
	}
	for (const [id, declared] of declaredDomains) {
		const definition = definedDomains.get(id);
		if (!definition) {
			issue("undefined-domain", `Domain object "${id}" has no definition in contracts.`);
		} else if (definition.home !== declared.home) {
			issue(
				"home-mismatch",
				`Domain object "${id}" is declared home "${declared.home}" but defined "${definition.home}".`,
			);
		} else {
			domains.set(id, { owner: pluginId, definition });
		}
	}
	for (const id of definedDomains.keys()) {
		if (!declaredDomains.has(id)) {
			issue("undeclared-domain", `Domain object "${id}" is not declared in plugin.json.`);
		}
	}
}

function collectContextKeys(
	candidates: readonly Candidate[],
	kernelKeys: readonly ContextKeyRecord[],
): ContextKeyRecord[] {
	const keys = [...kernelKeys];
	for (const { manifest } of candidates) {
		for (const key of manifest.contextKeys ?? []) {
			keys.push({ id: qualify(manifest.id, key.id), owner: manifest.id, scope: key.scope });
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
	points: ReadonlyMap<QualifiedId, PointRecord>,
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
	points: ReadonlyMap<QualifiedId, PointRecord>,
	domains: ReadonlyMap<QualifiedId, DomainRecord>,
	issues: KernelIssue[],
): DiscoveredPlugin[] {
	const ownerOfItem = (id: QualifiedId): string | undefined =>
		points.get(id)?.owner ?? domains.get(id)?.owner;

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
