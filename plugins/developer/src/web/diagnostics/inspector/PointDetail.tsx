import { KernelPlugins, type DomainObjectState, type ExtensionKind } from "@kilo-desktop/kernel";
import { useDomainObjectState, useKernel } from "@kilo-desktop/kernel/web";
import { Badge } from "@kilo-desktop/ui/components/badge";

import { describeCondition, item, type DetailItem, type DetailValue } from "../diagnostics-summary";
import {
	describePoint,
	ownerRef,
	type ContributionView,
	type PointView,
	type Requirement,
} from "../domain-model";
import {
	DetailHeader,
	Details,
	ExpandableRow,
	Panel,
	ROW_COLUMNS,
	StatusBadge,
	toDisplayJson,
} from "../parts";
import { useKernelChanges } from "./navigation";

const KINDS: Record<ExtensionKind, string> = {
	additive: "Additive — every contribution counts, ordered by priority",
	exclusive: "Exclusive — one winner (a pin, then priority); the rest are its fallbacks",
	decision: "Decision — the owner asks each contributor to proceed, ask or reject",
};

const selectPlugins = (state: DomainObjectState<typeof KernelPlugins>) => state.plugins;

export const ownerValue = (id: string): DetailValue => ({ code: id, link: ownerRef(id) });
const text = (value: string): DetailValue => ({ text: value });

function implementationText(implementation: NonNullable<PointView["implementation"]>): string {
	const where =
		implementation.process === "any"
			? "Bound in any process"
			: `Bound in the ${implementation.process} process`;
	return implementation.required
		? `${where}; a contribution without one is left out`
		: `${where}; optional`;
}

function definitionItems(view: PointView): DetailItem[] {
	return [
		{ label: "Kind", values: [text(KINDS[view.kind])] },
		{ label: "Owner", values: [ownerValue(view.owner)] },
		{
			label: "Implementation",
			values: [
				text(
					view.implementation
						? implementationText(view.implementation)
						: "None: contributions are metadata only",
				),
			],
		},
		...item(
			"Resources",
			view.resources
				? [
						text(
							"${resources} in contributions' metadata is replaced with the contributor's folder",
						),
					]
				: [],
		),
		...item(
			"Decision",
			view.decision
				? [
						text(
							`Fails ${view.decision.failMode} after ${view.decision.timeoutMs} ms; asked with:`,
						),
						{ block: view.decision.input },
					]
				: [],
		),
		{
			label: "Contribution metadata",
			values: [
				view.metadata ? { block: view.metadata } : text("None beyond id, priority and when"),
			],
		},
	];
}

/** Who requires a point or domain object, for its inspector detail. */
export function RequiredBy({ requirements }: { readonly requirements: readonly Requirement[] }) {
	return (
		<Panel title="Required by" testId="diagnostics-required-by">
			<Details
				className="border-t-0"
				items={[
					{
						label: "Plugins",
						values:
							requirements.length > 0
								? requirements.map(({ pluginId, need }) => ({
										...ownerValue(pluginId),
										note: need,
									}))
								: [text("No plugin requires it.")],
					},
				]}
			/>
		</Panel>
	);
}

function hasMetadata(metadata: unknown): boolean {
	return typeof metadata !== "object" || metadata === null || Object.keys(metadata).length > 0;
}

function ContributionRow({ contribution }: { readonly contribution: ContributionView }) {
	return (
		<ExpandableRow
			name={contribution.key}
			testId={`diagnostics-contribution-row-${contribution.key}`}
			columns={[
				contribution.id,
				<code>{contribution.pluginId}</code>,
				contribution.source === "manifest" ? "Manifest" : "Runtime",
			]}
			columnsClassName={ROW_COLUMNS}
			status={<StatusBadge status={contribution.status} />}
			details={() => (
				<Details
					testId={`diagnostics-contribution-details-${contribution.key}`}
					items={[
						{ label: "Contributor", values: [ownerValue(contribution.pluginId)] },
						{ label: "Priority", values: [text(String(contribution.priority))] },
						...item("When", contribution.conditions.map(describeCondition)),
						...item(
							"Implemented in",
							contribution.implementedIn
								? [
										text(
											contribution.implementedIn.length > 0
												? contribution.implementedIn.join(", ")
												: "Not implemented",
										),
									]
								: [],
						),
						{
							label: "Source",
							values: [
								text(
									contribution.source === "manifest"
										? "Declared in the plugin's manifest"
										: "Registered at runtime",
								),
							],
						},
						...item(
							"Metadata",
							hasMetadata(contribution.metadata)
								? [{ block: toDisplayJson(contribution.metadata) }]
								: [],
						),
					]}
				/>
			)}
		/>
	);
}

/** An extension point: its definition, what contributes to it and who requires it. */
export function PointDetail({ id }: { readonly id: string }) {
	const kernel = useKernel();
	useKernelChanges();
	const plugins = useDomainObjectState(KernelPlugins, selectPlugins);
	const view = describePoint(
		kernel,
		id,
		(pluginId) => plugins?.[pluginId]?.state ?? kernel.pluginState(pluginId),
	);
	if (!view) return <p className="text-muted-foreground text-sm">No extension point "{id}".</p>;
	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id={`diagnostics-point-${id}`}>
			<Panel>
				<DetailHeader
					title={<code>{view.id}</code>}
					subtitle="Extension point"
					status={<Badge variant="outline">{view.kind}</Badge>}
				/>
				<Details
					className="border-t-0"
					{...(view.description ? { description: view.description } : {})}
					items={definitionItems(view)}
				/>
			</Panel>
			<Panel
				title={`Contributions (${view.contributions.length})`}
				description="As this window sees them: runtime contributions made only in the main process aren't listed."
				testId="diagnostics-point-contributions"
			>
				{view.contributions.length > 0 ? (
					view.contributions.map((contribution) => (
						<ContributionRow key={contribution.key} contribution={contribution} />
					))
				) : (
					<p className="text-muted-foreground px-3 py-3 text-sm">Nothing contributes to it.</p>
				)}
			</Panel>
			<RequiredBy requirements={view.requiredBy} />
		</div>
	);
}
