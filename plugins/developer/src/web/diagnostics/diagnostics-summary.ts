import {
	KERNEL_OWNER,
	KernelService,
	ownerOf,
	qualify,
	type Kernel,
	type MetadataOf,
	type QualifiedId,
} from "@kilo-desktop/kernel";

export interface DetailItem {
	readonly label: string;
	/** Each value is one line; ids render as code. */
	readonly values: readonly DetailValue[];
}

export interface DetailValue {
	readonly code?: string;
	readonly text?: string;
	/** Listed beneath the value, e.g. the contributions made to a point. */
	readonly items?: readonly string[];
}

export interface PluginSummary {
	readonly description?: string;
	readonly items: readonly DetailItem[];
}

export interface IssueRecord {
	readonly severity: "error" | "warning";
	readonly message: string;
	readonly pluginId?: string | undefined;
}

type ServiceMetadata = MetadataOf<typeof KernelService>;

const START_ON: Record<ServiceMetadata["startOn"], string> = {
	activation: "When its plugin activates",
	"window-shown": "After the window shows",
	"first-use": "On first use",
};

const code = (value: string): DetailValue => ({ code: value });
const text = (value: string): DetailValue => ({ text: value });

function item(label: string, values: readonly DetailValue[]): DetailItem[] {
	return values.length > 0 ? [{ label, values }] : [];
}

/** What a plugin offers, contributes and needs, from its manifest and discovery. */
export function summarizePlugin(
	kernel: Kernel,
	pluginId: string,
	issues: readonly IssueRecord[],
	/** Plugins turned off (from the next launch). */
	turnedOff: ReadonlySet<string> = new Set(),
): PluginSummary {
	const manifest = kernel.manifest(pluginId);
	const usesTurnedOff = new Set(
		Object.keys(manifest?.requires ?? {})
			.map((id) => ownerOf(id as QualifiedId))
			.filter((owner) => owner !== pluginId && turnedOff.has(owner)),
	);
	const contributions = new Map<string, string[]>();
	for (const contribution of kernel.discovery.contributions) {
		if (contribution.pluginId !== pluginId) continue;
		const ids = contributions.get(contribution.pointId) ?? [];
		ids.push(contribution.entry.id);
		contributions.set(contribution.pointId, ids);
	}

	return {
		...(manifest?.description ? { description: manifest.description } : {}),
		items: [
			...item(
				"Extension points",
				(manifest?.extensionPoints ?? []).map((point) => code(qualify(pluginId, point.id))),
			),
			...item(
				"Domain objects",
				(manifest?.domains ?? []).map((domain) => code(qualify(pluginId, domain.id))),
			),
			...item(
				"Contributes to",
				[...contributions].map(([pointId, ids]) => ({ code: pointId, items: ids })),
			),
			...item("Host permissions", (manifest?.permissions?.host ?? []).map(code)),
			...item(
				"Context keys",
				(manifest?.contextKeys ?? []).map((key) => code(qualify(pluginId, key.id))),
			),
			...item(
				"Requires",
				Object.entries(manifest?.requires ?? {}).map(([id, need]) =>
					code(need === "optional" ? `${id} (optional)` : id),
				),
			),
			...item("Uses turned-off plugins", [...usesTurnedOff].map(code)),
			...item("Problems", issues.filter((issue) => issue.pluginId === pluginId).map(describeIssue)),
		],
	};
}

function describeIssue(issue: IssueRecord): DetailValue {
	return text(`${issue.severity === "error" ? "Error" : "Warning"}: ${issue.message}`);
}

/** What the kernel offers every plugin, and problems it reported itself (no plugin to blame). */
export function summarizeKernel(
	kernel: Kernel,
	issues: readonly IssueRecord[],
): readonly DetailItem[] {
	const { points, domains, contextKeys } = kernel.discovery;
	const ownedIds = (records: Iterable<{ readonly owner: string; readonly id: string }>) =>
		[...records].filter((record) => record.owner === KERNEL_OWNER).map((record) => code(record.id));
	const withId = (record: {
		readonly owner: string;
		readonly definition: { readonly id: string };
	}) => ({
		owner: record.owner,
		id: record.definition.id,
	});
	return [
		...item("Extension points", ownedIds([...points.values()].map(withId))),
		...item("Domain objects", ownedIds([...domains.values()].map(withId))),
		...item("Context keys", ownedIds(contextKeys)),
		...item("Problems", issues.filter((issue) => !issue.pluginId).map(describeIssue)),
	];
}

export function serviceKindLabel(kind: string): string {
	return kind === "daemon" ? "Daemon" : "Task";
}

/** How a supervised service runs, from its contribution and live record. */
export function summarizeService(
	kernel: Kernel,
	key: string,
	record: {
		readonly pluginId: string;
		readonly kind: string;
		readonly restarts: number;
		readonly progress?: string | undefined;
		readonly error?: string | undefined;
	},
): readonly DetailItem[] {
	const contribution = kernel.discovery.contributions.find(
		(candidate) =>
			candidate.pointId === KernelService.id &&
			qualify(candidate.pluginId, candidate.entry.id) === key,
	);
	const metadata = contribution?.entry.metadata as ServiceMetadata | undefined;
	const restart = metadata?.restart;
	return [
		{ label: "Plugin", values: [code(record.pluginId)] },
		{ label: "Kind", values: [text(serviceKindLabel(record.kind))] },
		...item("Starts", metadata ? [text(START_ON[metadata.startOn])] : []),
		...item(
			"Restart policy",
			restart
				? [
						text(
							restart.policy === "never"
								? "Never restarted"
								: `On failure, up to ${restart.maxRetries} times`,
						),
					]
				: [],
		),
		{ label: "Restarts", values: [text(String(record.restarts))] },
		...item("Progress", record.progress ? [text(record.progress)] : []),
		...item("Error", record.error ? [text(record.error)] : []),
	];
}
