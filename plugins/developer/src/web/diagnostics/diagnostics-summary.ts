import {
	KERNEL_OWNER,
	KernelFlag,
	KernelService,
	ownerOf,
	qualify,
	type Kernel,
	type MetadataOf,
	type QualifiedId,
} from "@kilo-desktop/kernel";

import { conditionsOf, entityFor, ownerRef, type Condition, type EntityRef } from "./domain-model";

export interface DetailItem {
	readonly label: string;
	/** Each value is one line; ids render as code. */
	readonly values: readonly DetailValue[];
}

export interface DetailValue {
	readonly code?: string;
	readonly text?: string;
	/** Preformatted, e.g. a type or JSON. */
	readonly block?: string;
	/** Opens what `code` names in the inspector. */
	readonly link?: EntityRef;
	/** A qualifier after the value, e.g. "optional". */
	readonly note?: string;
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
const pointLink = (id: string): DetailValue => ({ code: id, link: { kind: "point", id } });
const domainLink = (id: string): DetailValue => ({ code: id, link: { kind: "domain", id } });
const ownerLink = (id: string): DetailValue => ({ code: id, link: ownerRef(id) });
const objectTypeLink = (id: string): DetailValue => ({
	code: id,
	link: { kind: "objectType", id },
});
const contextKeyLink = (id: string): DetailValue => ({
	code: id,
	link: { kind: "contextKey", id },
});
const flagLink = (id: string): DetailValue => ({ code: id, link: { kind: "flag", id } });

/** `key must be on — now off`, for a `when` condition. */
export function describeCondition({ key, expected, actual }: Condition): DetailValue {
	const state = (on: boolean) => (on ? "on" : "off");
	return text(`${key} must be ${state(expected)} — now ${state(actual)}`);
}

export function item(label: string, values: readonly DetailValue[]): DetailItem[] {
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
	const flags: string[] = [];
	for (const contribution of kernel.discovery.contributions) {
		if (contribution.pluginId !== pluginId) continue;
		if (contribution.pointId === KernelFlag.id) flags.push(contribution.entry.id);
		const ids = contributions.get(contribution.pointId) ?? [];
		ids.push(contribution.entry.id);
		contributions.set(contribution.pointId, ids);
	}

	return {
		...(manifest?.description ? { description: manifest.description } : {}),
		items: [
			...item(
				"Extension points",
				(manifest?.extensionPoints ?? []).map((point) => pointLink(qualify(pluginId, point.id))),
			),
			...item("Runs while", conditionsOf(kernel, manifest?.when).map(describeCondition)),
			...item(
				"Domain objects",
				(manifest?.domainObjects ?? []).map((domain) => domainLink(qualify(pluginId, domain.id))),
			),
			...item(
				"Object types",
				(manifest?.objectTypes ?? []).map((type) => objectTypeLink(qualify(pluginId, type.id))),
			),
			...item(
				"Contributes to",
				[...contributions].map(([pointId, ids]) => ({
					...pointLink(pointId),
					items: ids,
				})),
			),
			...item("Host permissions", (manifest?.permissions?.host ?? []).map(code)),
			...item(
				"Context keys",
				(manifest?.contextKeys ?? []).map((key) => contextKeyLink(qualify(pluginId, key.id))),
			),
			...item("Flags", flags.map(flagLink)),
			...item(
				"Requires",
				Object.entries(manifest?.requires ?? {}).map(([id, need]) => {
					const link = entityFor(kernel, id);
					return {
						code: id,
						...(link ? { link } : {}),
						...(need === "optional" ? { note: "optional" } : {}),
					};
				}),
			),
			...item("Uses turned-off plugins", [...usesTurnedOff].map(ownerLink)),
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
	const { extensionPoints, domainObjects, objectTypes, contextKeys } = kernel.discovery;
	const ownedIds = (records: Iterable<{ readonly owner: string; readonly id: string }>) =>
		[...records].filter((record) => record.owner === KERNEL_OWNER).map((record) => record.id);
	const withId = (record: {
		readonly owner: string;
		readonly definition: { readonly id: string };
	}) => ({
		owner: record.owner,
		id: record.definition.id,
	});
	return [
		...item("Extension points", ownedIds([...extensionPoints.values()].map(withId)).map(pointLink)),
		...item("Domain objects", ownedIds([...domainObjects.values()].map(withId)).map(domainLink)),
		...item("Object types", ownedIds([...objectTypes.values()].map(withId)).map(objectTypeLink)),
		...item("Context keys", ownedIds(contextKeys).map(contextKeyLink)),
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
		{ label: "Plugin", values: [ownerLink(record.pluginId)] },
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
