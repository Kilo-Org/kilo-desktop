import { useKernel } from "@kilo-desktop/kernel/web";

import { item } from "../diagnostics-summary";
import { describeObjectType } from "../domain-model";
import { DetailHeader, Details, Panel, StatusBadge } from "../parts";
import { useKernelChanges, useMainDomainObjects } from "./navigation";
import { ownerValue } from "./PointDetail";

/** An object type: who owns the concept and which collection resolves references to it. */
export function ObjectTypeDetail({ id }: { readonly id: string }) {
	const kernel = useKernel();
	useKernelChanges();
	const view = describeObjectType(kernel, id, useMainDomainObjects());
	if (!view) return <p className="text-muted-foreground text-sm">No object type "{id}".</p>;
	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id={`diagnostics-object-type-${id}`}>
			<Panel>
				<DetailHeader
					title={<code>{view.id}</code>}
					subtitle="Object type"
					status={
						<StatusBadge
							status={
								view.collection ? (view.provided ? "resolved" : "unresolved") : "no collection"
							}
						/>
					}
				/>
				<Details
					className="border-t-0"
					{...(view.description ? { description: view.description } : {})}
					items={[
						{ label: "Owner", values: [ownerValue(view.owner)] },
						{
							label: "Resolved by",
							values: view.collection
								? [
										{
											code: view.collection,
											link: { kind: "domain", id: view.collection },
											note: view.provided ? "provided" : "not provided",
										},
									]
								: [{ text: "No collection resolves it: references to it can't be resolved." }],
						},
						...item("Reference", [{ block: `{ type: ${JSON.stringify(view.id)}, id: string }` }]),
					]}
				/>
			</Panel>
		</div>
	);
}
