import { useKernel } from "@kilo-desktop/kernel/web";
import { Badge } from "@kilo-desktop/ui/components/badge";

import { item, type DetailItem } from "../diagnostics-summary";
import { describeDomain, type DomainView } from "../domain-model";
import { DetailHeader, Details, Panel, StatusBadge } from "../parts";
import { useKernelChanges, useMainDomainObjects } from "./navigation";
import { ownerValue, RequiredBy } from "./PointDetail";

const HOMES: Record<DomainView["home"], string> = {
	main: "Main process — mirrored into every window",
	renderer: "Renderer — each window provides its own",
};

function definitionItems(view: DomainView): DetailItem[] {
	return [
		{ label: "Home", values: [{ text: HOMES[view.home] }] },
		{ label: "Owner", values: [ownerValue(view.owner)] },
		...item(
			"Permission",
			view.permission
				? [{ code: view.permission, note: "host permission callers other than the owner need" }]
				: [],
		),
		...item(
			"Callers",
			view.homeCallersOnly ? [{ text: `Only from the ${view.home} process` }] : [],
		),
		...item(
			"Object type",
			view.objectType
				? [
						{
							code: view.objectType,
							link: { kind: "objectType", id: view.objectType },
							note: "references of this type resolve to its items",
						},
					]
				: [],
		),
		...item("Lookup", view.hasLookup ? [{ text: "Looks items up by key in its state" }] : []),
	];
}

function shapeItems(view: DomainView): DetailItem[] {
	return [
		{ label: "State", values: [{ block: view.state }] },
		...item(
			"Methods",
			view.methods.map((signature) => ({ block: signature })),
		),
		...item(
			"Events",
			view.events.map((signature) => ({ block: signature })),
		),
	];
}

/** A domain object: where it lives, its shape (state, methods, events) and who requires it. */
export function DomainDetail({ id }: { readonly id: string }) {
	const kernel = useKernel();
	useKernelChanges();
	const view = describeDomain(kernel, id, useMainDomainObjects());
	if (!view) return <p className="text-muted-foreground text-sm">No domain object "{id}".</p>;
	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id={`diagnostics-domain-${id}`}>
			<Panel>
				<DetailHeader
					title={<code>{view.id}</code>}
					subtitle="Domain object"
					status={
						<>
							<Badge variant="outline">{view.home}</Badge>
							<StatusBadge status={view.provided ? "provided" : "not provided"} />
						</>
					}
				/>
				<Details
					className="border-t-0"
					{...(view.description ? { description: view.description } : {})}
					items={definitionItems(view)}
				/>
			</Panel>
			<Panel title="Shape">
				<Details className="border-t-0" items={shapeItems(view)} />
			</Panel>
			<RequiredBy requirements={view.requiredBy} />
		</div>
	);
}
