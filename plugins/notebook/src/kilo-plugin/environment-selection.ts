/**
 * Agent-facing view of a notebook's environment selection.
 *
 * The daemon keeps two targets per notebook: `selected` (staged intent) and
 * `applied` (what the running kernel was launched with), plus an `applying`
 * flag while a launch is in flight. Staging never touches the kernel; only a
 * successful apply moves `applied`. This module turns that snapshot and the
 * runtime status into a report that never calls a staged, applying, or
 * still-launching target active.
 *
 * Selection is intent, not proof of what runs. A target is reported active
 * only when the kernel is Running and its reported `environmentId` matches the
 * applied target; SDKs that do not report `environmentId` leave the running
 * identity unconfirmed rather than inferring it from equal selections.
 *
 * Capability checks are structural and per method: `@runtimed/node` builds and
 * daemons differ, and a missing method is reported as unsupported before any
 * prompt or call. Kernelspec targets need the installed-kernelspec catalog, so
 * its presence is the signal that the SDK understands `{kind: "kernelspec"}`.
 */
import path from "node:path";

export const CONDA_ENVIRONMENT_LIST_TOOL = "desktop_environments_conda_envs_list";

export const ENVIRONMENT_ACTIONS = ["status", "list_kernelspecs", "select", "apply"] as const;
export const ENVIRONMENT_TARGETS = ["automatic", "conda", "kernelspec"] as const;

export type EnvironmentAction = (typeof ENVIRONMENT_ACTIONS)[number];
export type EnvironmentTargetKind = (typeof ENVIRONMENT_TARGETS)[number];

export type EnvironmentArgs = {
	notebook_id: string;
	action: EnvironmentAction;
	target?: EnvironmentTargetKind;
	prefix?: string;
	name?: string;
	expected_revision?: number;
};

export type SelectionTarget =
	| { kind: "automatic" }
	| { kind: "conda"; prefix: string }
	| { kind: "kernelspec"; name: string };

export type EnvironmentRequest =
	| { action: "status" }
	| { action: "list_kernelspecs" }
	| { action: "select"; target: SelectionTarget; expectedRevision: number }
	| { action: "apply"; expectedRevision: number };

type CondaEnvironmentInfo = {
	id: string;
	name: string;
	prefix: string;
	pythonPath: string;
	pythonVersion?: string;
};

type KernelspecInfo = { name: string; displayName: string; language: string };

export type EnvironmentSelection = {
	revision: number;
	selected?: CondaEnvironmentInfo | null;
	applied?: CondaEnvironmentInfo | null;
	selectedKernelspec?: KernelspecInfo | null;
	appliedKernelspec?: KernelspecInfo | null;
	applying: boolean;
};

export type KernelspecInventory = {
	kernelspecs: KernelspecInfo[];
	warnings: string[];
	truncated: boolean;
};

export type SelectionSession = {
	getEnvironmentSelection(): Promise<EnvironmentSelection>;
	setEnvironmentSelection(
		target: SelectionTarget,
		expectedRevision: number,
	): Promise<EnvironmentSelection>;
	applyEnvironmentSelection(expectedRevision: number): Promise<EnvironmentSelection>;
	listInstalledKernelspecs(): Promise<KernelspecInventory>;
};

export type Capability = "environment_selection" | "installed_kernelspecs";

type Requirement = { capability: Capability; methods: readonly (keyof SelectionSession)[] };

function requirementFor(request: EnvironmentRequest): Requirement {
	switch (request.action) {
		case "status":
			return { capability: "environment_selection", methods: ["getEnvironmentSelection"] };
		case "list_kernelspecs":
			return { capability: "installed_kernelspecs", methods: ["listInstalledKernelspecs"] };
		case "select":
			return request.target.kind === "kernelspec"
				? {
						capability: "installed_kernelspecs",
						methods: ["setEnvironmentSelection", "listInstalledKernelspecs"],
					}
				: { capability: "environment_selection", methods: ["setEnvironmentSelection"] };
		case "apply":
			return { capability: "environment_selection", methods: ["applyEnvironmentSelection"] };
	}
}

/** The capability a request lacks on this session, or null when every method it calls exists. */
export function missingCapability(session: object, request: EnvironmentRequest): Capability | null {
	const { capability, methods } = requirementFor(request);
	const record = session as Record<string, unknown>;
	return methods.every((method) => typeof record[method] === "function") ? null : capability;
}

/**
 * Kilo hands plugin tools the model's raw arguments, so every field is checked
 * here before the notebook is opened.
 */
export function parseEnvironmentArgs(args: EnvironmentArgs): EnvironmentRequest {
	const raw = args as Record<string, unknown>;
	const action = raw.action;
	if (!ENVIRONMENT_ACTIONS.includes(action as EnvironmentAction)) {
		throw new Error(
			`action must be one of ${ENVIRONMENT_ACTIONS.join(", ")}; got ${JSON.stringify(action)}.`,
		);
	}
	if (action === "status" || action === "list_kernelspecs") {
		return { action: action as "status" | "list_kernelspecs" };
	}
	const expectedRevision = raw.expected_revision;
	if (
		typeof expectedRevision !== "number" ||
		!Number.isSafeInteger(expectedRevision) ||
		expectedRevision < 0
	) {
		throw new Error(
			`expected_revision must be the nonnegative integer revision from notebooks_environment action status; got ${JSON.stringify(expectedRevision)}.`,
		);
	}
	if (action === "apply") return { action, expectedRevision };
	return { action: "select", target: parseTarget(raw), expectedRevision };
}

function parseTarget(raw: Record<string, unknown>): SelectionTarget {
	const { target, prefix, name } = raw;
	if (!ENVIRONMENT_TARGETS.includes(target as EnvironmentTargetKind)) {
		throw new Error(
			`target must be one of ${ENVIRONMENT_TARGETS.join(", ")}; got ${JSON.stringify(target)}.`,
		);
	}
	if (prefix !== undefined && target !== "conda") {
		throw new Error("prefix only applies to target conda.");
	}
	if (name !== undefined && target !== "kernelspec") {
		throw new Error("name only applies to target kernelspec.");
	}
	switch (target as EnvironmentTargetKind) {
		case "automatic":
			return { kind: "automatic" };
		case "conda":
			if (typeof prefix !== "string" || !path.isAbsolute(prefix.trim())) {
				throw new Error(
					`target conda needs the absolute Conda prefix of an existing environment, as listed by ${CONDA_ENVIRONMENT_LIST_TOOL}; got ${JSON.stringify(prefix)}.`,
				);
			}
			return { kind: "conda", prefix: prefix.trim() };
		case "kernelspec":
			if (typeof name !== "string" || !name.trim()) {
				throw new Error(
					"target kernelspec needs an installed kernelspec name from notebooks_environment action list_kernelspecs.",
				);
			}
			return { kind: "kernelspec", name: name.trim() };
	}
}

type ProjectedTarget =
	| { kind: "automatic" }
	| {
			kind: "conda";
			id: string;
			name: string;
			prefix: string;
			python_path: string;
			python_version?: string;
	  }
	| { kind: "kernelspec"; name: string; display_name: string; language: string };

function projectTarget(
	conda: CondaEnvironmentInfo | null | undefined,
	kernelspec: KernelspecInfo | null | undefined,
): ProjectedTarget {
	if (kernelspec) {
		return {
			kind: "kernelspec",
			name: kernelspec.name,
			display_name: kernelspec.displayName,
			language: kernelspec.language,
		};
	}
	if (conda) {
		return {
			kind: "conda",
			id: conda.id,
			name: conda.name,
			prefix: conda.prefix,
			python_path: conda.pythonPath,
			...(conda.pythonVersion ? { python_version: conda.pythonVersion } : {}),
		};
	}
	return { kind: "automatic" };
}

function targetIdentity(target: ProjectedTarget): string {
	switch (target.kind) {
		case "automatic":
			return "automatic";
		case "conda":
			return `conda:${target.prefix}`;
		case "kernelspec":
			return `kernelspec:${target.name}`;
	}
}

function describeTarget(target: ProjectedTarget): string {
	switch (target.kind) {
		case "automatic":
			return "the automatic environment";
		case "conda":
			return `Conda environment ${target.name} (${target.prefix})`;
		case "kernelspec":
			return `kernelspec ${target.name} (${target.display_name})`;
	}
}

export type RuntimeView = {
	lifecycle?: string;
	status?: string;
	name?: string;
	language?: string;
	runtimeAgentId?: string;
	envSource?: string;
	environmentId?: string;
	environmentName?: string;
	pythonVersion?: string;
};

function runtimeIdentity(runtime: RuntimeView) {
	const fields = {
		name: runtime.name,
		language: runtime.language,
		runtime_agent_id: runtime.runtimeAgentId,
		env_source: runtime.envSource,
		environment_id: runtime.environmentId,
		environment_name: runtime.environmentName,
		python_version: runtime.pythonVersion,
	};
	return Object.fromEntries(Object.entries(fields).filter(([, value]) => Boolean(value)));
}

/**
 * Identity fields describe the kernel process only once it is Running. During
 * a launch, older SDKs can still report the previous kernel's values, so they
 * are grouped under `unconfirmed`.
 */
export function projectKernel(runtime: RuntimeView | null) {
	if (!runtime) return null;
	const identity = runtimeIdentity(runtime);
	const hasIdentity = Object.keys(identity).length > 0;
	return {
		lifecycle: runtime.lifecycle,
		status: runtime.status,
		...(runtime.lifecycle === "Running" ? identity : hasIdentity ? { unconfirmed: identity } : {}),
	};
}

type RunningIdentity = "confirmed" | "mismatch" | "unconfirmed";

function runningIdentity(applied: ProjectedTarget, runtime: RuntimeView | null): RunningIdentity {
	if (runtime?.lifecycle !== "Running" || !runtime.environmentId) return "unconfirmed";
	switch (applied.kind) {
		case "automatic":
			return "confirmed";
		case "conda":
			return runtime.environmentId === applied.id ? "confirmed" : "mismatch";
		case "kernelspec":
			return runtime.environmentId === `kernelspec:${applied.name}` ? "confirmed" : "mismatch";
	}
}

function appliedSummary(
	applied: ProjectedTarget,
	identity: RunningIdentity,
	runtime: RuntimeView | null,
): string {
	const target = capitalize(describeTarget(applied));
	if (identity === "confirmed") {
		return `${target} was last applied and the running kernel reports environment ${runtime?.environmentId}.`;
	}
	if (identity === "mismatch") {
		return (
			`${target} was last applied, but the running kernel reports environment ${runtime?.environmentId}. ` +
			"Do not treat the applied target as active; check notebooks_diagnose."
		);
	}
	if (runtime?.lifecycle === "Running") {
		return (
			`${target} was last applied and a kernel is running, but this notebook runtime does not report ` +
			"which environment it runs in, so the active environment is unconfirmed."
		);
	}
	return `${target} was last applied, but the kernel is ${runtime?.lifecycle || "in an unknown state"}, so no environment is confirmed active.`;
}

export function selectionReport(
	notebookId: string,
	action: EnvironmentAction,
	selection: EnvironmentSelection,
	runtime: RuntimeView | null,
) {
	const selected = projectTarget(selection.selected, selection.selectedKernelspec);
	const applied = projectTarget(selection.applied, selection.appliedKernelspec);
	const staged = targetIdentity(selected) !== targetIdentity(applied);
	const state = selection.applying ? "applying" : staged ? "staged" : "applied";
	const identity = runningIdentity(applied, runtime);
	const summary =
		state === "applying"
			? `Applying ${describeTarget(selected)}. The kernel is launching and the selection is not active yet. Check status again.`
			: state === "staged"
				? `Staged ${describeTarget(selected)}; it is not applied. ${appliedSummary(applied, identity, runtime)} ` +
					`To switch, call notebooks_environment action apply with expected_revision ${selection.revision}; ` +
					"it asks the user, then restarts the kernel and clears its variables."
				: appliedSummary(applied, identity, runtime);
	return {
		notebook_id: notebookId,
		action,
		revision: selection.revision,
		state,
		active: state === "applied" && identity === "confirmed",
		running_identity: selection.applying ? "unconfirmed" : identity,
		applying: selection.applying,
		selected,
		applied,
		kernel: projectKernel(runtime),
		summary,
	};
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export function inventoryReport(notebookId: string, inventory: KernelspecInventory) {
	return {
		notebook_id: notebookId,
		action: "list_kernelspecs" as const,
		kernelspecs: inventory.kernelspecs.map((spec) => ({
			name: spec.name,
			display_name: spec.displayName,
			language: spec.language,
		})),
		warnings: inventory.warnings,
		truncated: inventory.truncated,
	};
}

export function unsupportedReport(
	notebookId: string,
	action: EnvironmentAction,
	capability: Capability,
) {
	const what =
		capability === "installed_kernelspecs"
			? "installed kernelspec selection"
			: "notebook environment selection";
	return {
		notebook_id: notebookId,
		action,
		status: "unsupported" as const,
		capability,
		changed: false,
		message:
			`The installed notebook SDK does not support ${what}. Nothing was changed. ` +
			"Do not register a kernelspec or edit the notebook file to work around this; tell the user the notebook runtime needs an update.",
	};
}
