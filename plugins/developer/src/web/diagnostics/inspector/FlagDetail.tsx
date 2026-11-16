import { useKernel } from "@kilo-desktop/kernel/web";
import { Badge } from "@kilo-desktop/ui/components/badge";

import { describeFlag } from "../domain-model";
import { FLAG_ORIGIN_TEXT, useFlags } from "../flags";
import { DetailHeader, Details, Panel, StatusBadge } from "../parts";
import { KeyUses } from "./key-uses";
import { useKernelChanges } from "./navigation";
import { ownerValue } from "./PointDetail";

/** A flag: its value and where it came from, who declared it and what it gates. */
export function FlagDetail({ id }: { readonly id: string }) {
	const kernel = useKernel();
	useKernelChanges();
	const flags = useFlags();
	const view = describeFlag(kernel, id, flags?.flags);
	if (!view) return <p className="text-muted-foreground text-sm">No flag "{id}".</p>;
	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id={`diagnostics-flag-${id}`}>
			<Panel>
				<DetailHeader
					title={<code>{view.id}</code>}
					subtitle="Flag"
					status={
						<>
							<Badge variant="outline">{JSON.stringify(view.value)}</Badge>
							<StatusBadge status={view.origin} />
						</>
					}
				/>
				<Details
					className="border-t-0"
					description={view.description}
					testId="diagnostics-flag-details"
					items={[
						{ label: "Value", values: [{ code: JSON.stringify(view.value) }] },
						{ label: "Default", values: [{ code: JSON.stringify(view.default) }] },
						{ label: "Origin", values: [{ text: FLAG_ORIGIN_TEXT[view.origin] ?? view.origin }] },
						{ label: "Declared by", values: [ownerValue(view.pluginId)] },
						{
							label: "Context key",
							values: [
								{
									code: view.contextKey,
									link: { kind: "contextKey", id: "kernel/flag:*" },
									note: kernel.contextKeys.get(view.contextKey) ? "on" : "off",
								},
							],
						},
						...(flags?.ready
							? []
							: [{ label: "Flag source", values: [{ text: "Still evaluating" }] }]),
					]}
				/>
			</Panel>
			<KeyUses title="Gates" uses={view.gates} empty="Nothing runs only while it is on or off." />
		</div>
	);
}
