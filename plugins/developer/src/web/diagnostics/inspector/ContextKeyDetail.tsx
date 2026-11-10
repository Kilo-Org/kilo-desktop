import { useKernel } from "@kilo-desktop/kernel/web";
import { Badge } from "@kilo-desktop/ui/components/badge";

import { describeContextKey, usesOf } from "../domain-model";
import { DetailHeader, Details, Panel, StatusBadge } from "../parts";
import { KeyUses } from "./key-uses";
import { useKernelChanges } from "./navigation";
import { ownerValue } from "./PointDetail";

const SCOPES = {
	global: "Global — set in main and mirrored into every window",
	window: "Window — each window sets its own",
} as const;

const onOff = (value: boolean) => (value ? "on" : "off");

/** A context key: who sets it, its value in this window and the conditions that read it. */
export function ContextKeyDetail({ id }: { readonly id: string }) {
	const kernel = useKernel();
	useKernelChanges();
	const view = describeContextKey(kernel, id);
	if (!view) return <p className="text-muted-foreground text-sm">No context key "{id}".</p>;
	const [single] = view.values;
	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id={`diagnostics-context-key-${id}`}>
			<Panel>
				<DetailHeader
					title={<code>{view.id}</code>}
					subtitle={view.pattern ? "Context keys" : "Context key"}
					status={
						<>
							<Badge variant="outline">{view.scope}</Badge>
							{view.pattern || !single ? null : <StatusBadge status={onOff(single.value)} />}
						</>
					}
				/>
				<Details
					className="border-t-0"
					{...(view.description ? { description: view.description } : {})}
					items={[
						{ label: "Owner", values: [ownerValue(view.owner)] },
						{ label: "Scope", values: [{ text: SCOPES[view.scope] }] },
						{
							label: view.pattern ? "Set in this window" : "In this window",
							values:
								view.values.length > 0
									? view.values.map(({ key, value }) =>
											view.pattern ? { code: key, note: onOff(value) } : { text: onOff(value) },
										)
									: [{ text: "None set" }],
						},
					]}
					testId="diagnostics-context-key-details"
				/>
			</Panel>
			<KeyUses
				title="Read by"
				uses={usesOf(kernel, view.id)}
				empty="No plugin or manifest contribution reads it."
			/>
		</div>
	);
}
