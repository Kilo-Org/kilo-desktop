import {
	KERNEL_OWNER,
	KernelApp,
	KernelPlugins,
	type DomainObjectState,
} from "@kilo-desktop/kernel";
import { useDomainObjectState, useKernel } from "@kilo-desktop/kernel/web";

import {
	summarizeKernel,
	summarizePlugin,
	type IssueRecord,
	type PluginSummary,
} from "../diagnostics-summary";
import { DetailHeader, Details, Panel, StatusBadge } from "../parts";
import { useKernelChanges } from "./navigation";

const selectApp = (state: DomainObjectState<typeof KernelApp>) => state;
const selectPlugins = (state: DomainObjectState<typeof KernelPlugins>) => state.plugins;

const KERNEL_DESCRIPTION =
	"The product-agnostic plugin runtime: the extension points, domain objects, object types and context keys every plugin can use.";

/** A plugin, or the kernel: what it offers, contributes and needs. */
export function OwnerDetail({
	id,
	issues,
	turnedOff,
}: {
	readonly id: string;
	readonly issues: readonly IssueRecord[];
	readonly turnedOff: ReadonlySet<string>;
}) {
	const kernel = useKernel();
	useKernelChanges();
	const app = useDomainObjectState(KernelApp, selectApp);
	const plugins = useDomainObjectState(KernelPlugins, selectPlugins);

	const kernelOwner = id === KERNEL_OWNER;
	const plugin = plugins?.[id];
	const manifest = kernel.manifest(id);
	if (!kernelOwner && !manifest) {
		return <p className="text-muted-foreground text-sm">No plugin "{id}".</p>;
	}
	const summary: PluginSummary = kernelOwner
		? { description: KERNEL_DESCRIPTION, items: summarizeKernel(kernel, issues) }
		: summarizePlugin(kernel, id, issues, turnedOff);
	const state = kernelOwner ? app?.phase : (plugin?.state ?? kernel.pluginState(id));
	const version = kernelOwner ? app?.version : manifest?.version;

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id={`diagnostics-owner-${id}`}>
			<Panel>
				<DetailHeader
					title={kernelOwner ? "Kernel" : manifest?.displayName}
					subtitle={
						<>
							<code>{id}</code>
							{version ? ` · ${version}` : null}
						</>
					}
					{...(state ? { status: <StatusBadge status={state} /> } : {})}
				/>
				<Details
					className="border-t-0"
					{...(summary.description ? { description: summary.description } : {})}
					items={summary.items}
				/>
			</Panel>
		</div>
	);
}
