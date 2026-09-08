import { createLucideIcon, FileIcon } from "lucide-react";

import {
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@anaconda-agentic-desktop/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type { LocalModel } from "../contracts/schemas.js";

// lucide-react 1.27 does not export Eject yet; this is the upstream glyph.
const EjectIcon = createLucideIcon("eject", [
	[
		"path",
		{
			d: "M4 13a1 1 0 0 1-.72-1.695l7.257-7.668a2 2 0 0 1 2.926 0l7.256 7.668A1 1 0 0 1 20 13z",
			key: "triangle",
		},
	],
	["rect", { x: "3", y: "17", width: "18", height: "4", rx: "1", key: "bar" }],
]);

function ModelStatusDot({ modelId, loaded }: { modelId: string; loaded: boolean }) {
	return (
		<span
			className={cn(
				"size-2 shrink-0 rounded-full",
				loaded ? "bg-primary" : "bg-muted-foreground/35",
			)}
			data-qa-id={`local-model-status-${modelId}`}
			data-status={loaded ? "loaded" : "not-loaded"}
			aria-hidden
		/>
	);
}

export function ModelSidebar({
	models,
	loadedModelIds,
	selectedModelId,
	removing,
	onSelect,
	onEject,
}: {
	models: readonly LocalModel[];
	loadedModelIds: ReadonlySet<string>;
	selectedModelId: string | undefined;
	removing: boolean;
	onSelect: (modelId: string) => void;
	onEject: (modelId: string) => void;
}) {
	return (
		<nav aria-label="Available models" className="min-w-0">
			<SidebarMenu className="gap-px">
				{models.map((model) => {
					const selected = model.id === selectedModelId;
					const loaded = loadedModelIds.has(model.id);
					return (
						<SidebarMenuItem key={model.id}>
							<SidebarMenuButton
								type="button"
								size="lg"
								isActive={selected}
								aria-pressed={selected}
								className="data-active:bg-foreground/5 data-active:hover:bg-foreground/5 rounded-lg"
								data-qa-id={`local-model-select-${model.id}`}
								onClick={() => onSelect(model.id)}
							>
								<FileIcon className="text-muted-foreground" aria-hidden />
								<div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
									<Tooltip>
										<TooltipTrigger
											render={
												<span
													className="truncate text-sm leading-4 font-medium"
													data-qa-id={`local-model-title-${model.id}`}
												/>
											}
										>
											{model.name}
										</TooltipTrigger>
										<TooltipContent
											side="right"
											className="max-w-md font-mono break-all"
											data-qa-id={`local-model-path-${model.id}`}
										>
											{model.path}
										</TooltipContent>
									</Tooltip>
									<span className="text-muted-foreground flex items-center gap-1.5 text-[11px] leading-none">
										<ModelStatusDot modelId={model.id} loaded={loaded} />
										{loaded ? "Loaded" : "Not loaded"}
									</span>
								</div>
							</SidebarMenuButton>
							<SidebarMenuAction
								type="button"
								className="top-1/2! -translate-y-1/2"
								aria-label={`Eject ${model.name}`}
								disabled={removing}
								data-qa-id={`local-model-eject-${model.id}`}
								onClick={() => onEject(model.id)}
							>
								<EjectIcon className="size-3!" />
							</SidebarMenuAction>
						</SidebarMenuItem>
					);
				})}
			</SidebarMenu>
		</nav>
	);
}
