/**
 * User approval for dependency changes the agent makes through `@runtimed/node`.
 *
 * The daemon trusts a notebook when every declared dependency is on a
 * machine-wide allowlist, but the node binding's `addDependencies` and
 * `removeDependencies` approve *every* current dependency without asking.
 * Without this gate, an agent adding one package to a notebook opened from
 * disk would silently allowlist everything that notebook declares. So every
 * agent change that ends in an approval first shows the user exactly what will
 * become approved (the notebook's unapproved dependencies plus new packages),
 * with typosquat suspects marked.
 *
 * Invariants:
 * - "Always allow" is remembered per package name, matching the allowlist's
 *   per-package scope; typosquat suspects and already-unapproved notebook
 *   dependencies are never remembered.
 * - The binding cannot pass nteract's `observed_heads` guard, so the dependency
 *   fingerprint is compared before and after the prompt instead; a change while
 *   the prompt was open aborts without approving anything.
 */
import type { Session } from "@runtimed/node";

import {
	checkTyposquat,
	extractPackageName,
	normalizeName,
	type TyposquatWarning,
} from "../shared/typosquat";

type DependencyStatus = Awaited<ReturnType<Session["getDependencyStatus"]>>;

type DependencySource = "uv" | "conda" | "pixi" | "pixi-pypi";

interface DeclaredDependency {
	readonly source: DependencySource;
	readonly spec: string;
}

/** Kilo v2's `permission.assert`, bound to the tool call: prompts when needed and rejects on a decline. */
export interface ApprovalContext {
	assert(input: {
		action: string;
		resources: string[];
		save: string[];
		metadata: Record<string, unknown>;
	}): Promise<void>;
}

export type DependencyChange =
	| { readonly kind: "add"; readonly packages: readonly string[] }
	| { readonly kind: "remove"; readonly packages: readonly string[] }
	| { readonly kind: "approve" };

/**
 * Packages and channels runtimed seeds into every machine's allowlist
 * (nteract `crates/runtimed/src/daemon.rs`, f85f9824718d6e251413cc9642439d6854a6c475).
 * Keep in sync: a name here is added without a prompt.
 */
const DEFAULT_APPROVED_PACKAGES = new Set([
	"ipykernel",
	"ipywidgets",
	"anywidget",
	"pip",
	"nbformat",
	"pyarrow",
	"pandas",
	"polars",
	"matplotlib",
	"plotly",
	"altair",
	"numpy",
	"scipy",
]);
const DEFAULT_APPROVED_CHANNELS = new Set([
	"conda-forge",
	"defaults",
	"https://repo.anaconda.com/pkgs/main",
	"https://repo.anaconda.com/pkgs/main/",
	"https://repo.anaconda.com/pkgs/r",
	"https://repo.anaconda.com/pkgs/r/",
	"https://repo.anaconda.com/pkgs/msys2",
	"https://repo.anaconda.com/pkgs/msys2/",
]);

const TRUST_REJECTION_MESSAGE = "Trust changed before the action could run";

function stringList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

function declaredDependencies(status: DependencyStatus): DeclaredDependency[] {
	const from = (source: DependencySource, specs: readonly string[] | undefined) =>
		(specs ?? []).map((spec) => ({ source, spec }));
	return [
		...from("uv", status.uv?.dependencies),
		...from("conda", status.conda?.dependencies),
		...from("pixi", status.pixi?.dependencies),
		...from("pixi-pypi", status.pixi?.pypiDependencies),
	];
}

export function declaredDependencySpecs(status: DependencyStatus): string[] {
	return declaredDependencies(status).map(({ spec }) => spec);
}

export interface DependencyTrust {
	readonly needsApproval: boolean;
	readonly unapproved: readonly DeclaredDependency[];
	/** Non-default channels; they explain an untrusted notebook whose packages are all approved. */
	readonly channels: readonly string[];
}

export function dependencyTrust(status: DependencyStatus): DependencyTrust {
	const trust = (status.trust ?? {}) as Record<string, unknown>;
	const needsApproval = trust["needsApproval"] === true || trust["status"] === "untrusted";
	if (!needsApproval) return { needsApproval, unapproved: [], channels: [] };

	// The daemon only refreshes these lists while trust is unsettled; a kernel
	// launch clears them, so they are read only when approval is pending.
	const approved: Record<DependencySource, Set<string>> = {
		uv: new Set(stringList(trust["approvedUvDependencies"])),
		conda: new Set(stringList(trust["approvedCondaDependencies"])),
		pixi: new Set(stringList(trust["approvedPixiDependencies"])),
		"pixi-pypi": new Set(stringList(trust["approvedPixiPypiDependencies"])),
	};
	const nonDefault = (channels: readonly string[] | undefined) =>
		(channels ?? []).filter((channel) => !DEFAULT_APPROVED_CHANNELS.has(channel.trim()));
	const channels = [
		...nonDefault(status.conda?.channels).map((channel) => `conda channel: ${channel}`),
		...nonDefault(status.pixi?.channels).map((channel) => `pixi channel: ${channel}`),
	];
	return {
		needsApproval,
		unapproved: declaredDependencies(status).filter(
			({ source, spec }) => !approved[source].has(spec),
		),
		channels,
	};
}

/** Labels for what an approval would cover right now, e.g. `uv: evil-pkg` or `conda channel: my-org`. */
export function pendingApprovalLabels(trust: DependencyTrust): string[] {
	if (!trust.needsApproval) return [];
	return trust.unapproved.length > 0
		? trust.unapproved.map(({ source, spec }) => `${source}: ${spec}`)
		: [...trust.channels];
}

function packageKey(spec: string): string {
	return normalizeName(extractPackageName(spec));
}

/** Plain registry names from default channels are seeded by the daemon, so adding them approves nothing new. */
function isDefaultApproved(spec: string): boolean {
	const trimmed = spec.trim();
	const separator = trimmed.lastIndexOf("::");
	if (separator !== -1 && !DEFAULT_APPROVED_CHANNELS.has(trimmed.slice(0, separator))) return false;
	const unqualified = separator === -1 ? trimmed : trimmed.slice(separator + 2);
	return !/[@/:]/.test(unqualified) && DEFAULT_APPROVED_PACKAGES.has(packageKey(unqualified));
}

interface ApprovalItem {
	/** What becomes approved, e.g. `uv: evil-pkg` or `requests`. */
	readonly approves: string;
	readonly warning?: TyposquatWarning;
	readonly rememberable: boolean;
	/** Already declared by the notebook rather than requested by the agent. */
	readonly existing: boolean;
}

const PROMPT_LABEL = "Notebook packages";
const PROMPT_DESCRIPTION =
	"Approved packages can be installed into any notebook on this computer without asking again. " +
	"Only approve packages you recognize.";

function describePackages(specs: readonly string[]): string {
	const names = [...new Set(specs.map(extractPackageName))];
	if (names.length === 1) return names[0]!;
	if (names.length === 2) return `${names[0]} and ${names[1]}`;
	return `${names.length} packages`;
}

function promptTitle(change: DependencyChange, items: readonly ApprovalItem[]): string {
	if (items.some((item) => item.warning)) {
		return "Check package names: some look like misspellings of popular packages";
	}
	switch (change.kind) {
		case "approve":
			return "Approve the packages this notebook needs?";
		case "remove":
			return `Removing ${describePackages(change.packages)} will approve the packages that remain`;
		case "add":
			return items.some((item) => item.existing)
				? `Installing ${describePackages(change.packages)} will also approve packages this notebook already lists`
				: `Allow the agent to install ${describePackages(items.map((item) => item.approves))} in this notebook?`;
	}
}

function itemLabel(item: ApprovalItem): string {
	return item.warning ? `${item.approves} (similar to ${item.warning.similar_to})` : item.approves;
}

function existingItems(trust: DependencyTrust, removed: ReadonlySet<string>): ApprovalItem[] {
	if (!trust.needsApproval) return [];
	const remaining = trust.unapproved
		.filter(({ spec }) => !removed.has(packageKey(spec)))
		.map(({ source, spec }) => {
			const warning = checkTyposquat(spec);
			return {
				approves: `${source}: ${spec}`,
				rememberable: false,
				existing: true,
				...(warning ? { warning } : {}),
			};
		});
	if (remaining.length > 0) return remaining;
	// No unapproved package explains the pending approval (or a removal cleared
	// them all), so the channels are what the edit would approve. Approved
	// channels aren't reported, so this may also list one approved earlier.
	return trust.channels.map((approves) => ({ approves, rememberable: false, existing: true }));
}

function requestedItems(
	status: DependencyStatus,
	trust: DependencyTrust,
	packages: readonly string[],
) {
	const unapprovedSpecs = new Set(trust.unapproved.map(({ spec }) => spec));
	const unapprovedPackages = new Set(trust.unapproved.map(({ spec }) => packageKey(spec)));
	const approvedSpecs = new Set(
		declaredDependencySpecs(status).filter((spec) => !unapprovedSpecs.has(spec)),
	);
	const items = new Map<string, ApprovalItem>();
	for (const spec of packages) {
		// An exact re-request of an unapproved dependency is already listed by `existingItems`.
		if (approvedSpecs.has(spec) || unapprovedSpecs.has(spec) || isDefaultApproved(spec)) continue;
		const approves = extractPackageName(spec);
		const warning = checkTyposquat(spec);
		items.set(approves, {
			approves,
			// A package the notebook already declares unapproved is never remembered,
			// even when the agent requests it with a different spec.
			rememberable: !warning && !unapprovedPackages.has(packageKey(spec)),
			existing: false,
			...(warning ? { warning } : {}),
		});
	}
	return [...items.values()];
}

function planApproval(status: DependencyStatus, change: DependencyChange): ApprovalItem[] {
	const trust = dependencyTrust(status);
	switch (change.kind) {
		case "add":
			return [
				...existingItems(trust, new Set()),
				...requestedItems(status, trust, change.packages),
			];
		case "remove":
			return existingItems(trust, new Set(change.packages.map(packageKey)));
		case "approve":
			return existingItems(trust, new Set());
	}
}

/**
 * Asks the user to approve what `change` would allowlist. Resolves `true` when
 * approval was required and granted, `false` when nothing needed approval;
 * rejects when the user declines or the dependencies changed during the prompt.
 */
export async function requireDependencyApproval(
	context: ApprovalContext,
	session: Session,
	notebookId: string,
	change: DependencyChange,
): Promise<boolean> {
	const status = await session.getDependencyStatus();
	const items = planApproval(status, change);
	if (items.length === 0) return false;

	await context.assert({
		action: "notebooks_trust",
		resources: items.map(itemLabel),
		save: items.filter((item) => item.rememberable).map(itemLabel),
		metadata: {
			// `toolName`, `title`, and `description` are what the chat permission card displays.
			toolName: PROMPT_LABEL,
			title: promptTitle(change, items),
			description: PROMPT_DESCRIPTION,
			notebook_id: notebookId,
			action: change.kind,
			approves: items.map((item) => item.approves),
			typosquat_warnings: items.flatMap((item) => (item.warning ? [item.warning] : [])),
		},
	});

	const current = await session.dependencyFingerprint();
	if ((current ?? undefined) !== (status.fingerprint ?? undefined)) {
		throw new Error(
			"The notebook dependencies changed while approval was pending, so nothing was approved. Review the dependencies and try again.",
		);
	}
	return true;
}

function isTrustRejection(error: unknown): boolean {
	return error instanceof Error && error.message.includes(TRUST_REJECTION_MESSAGE);
}

async function trustRejectionGuidance(session: Session): Promise<string> {
	let pending: string[] = [];
	try {
		pending = pendingApprovalLabels(dependencyTrust(await session.getDependencyStatus()));
	} catch {
		// The guidance still applies without the list.
	}
	const list = pending.length > 0 ? `: ${pending.join(", ")}` : "";
	return (
		`Notebook dependencies need approval before the kernel can start or install packages${list}. ` +
		"Ask the user to click Review in the notebook's banner, or call notebooks_dependencies with " +
		"action approve_trust, which asks the user first."
	);
}

/** Replaces the daemon's generic trust-gate rejection with actionable guidance. */
export async function withTrustGuidance<T>(session: Session, action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		if (!isTrustRejection(error)) throw error;
		throw new Error(await trustRejectionGuidance(session), { cause: error });
	}
}
