"use client";

import { ChevronDownIcon } from "lucide-react";
import type { CSSProperties, FC } from "react";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { useChatAgentSelection } from "../../agent-selection/ChatAgentSelectionContext.js";
import { findCatalogAgent, OPTIMISTIC_AGENT_CATALOG } from "../../agent-selection/agent-catalog.js";
import { AgentIcon } from "../../agent-selection/agent-icon.js";
import { modelSelectorTriggerVariants } from "./model-selector.js";

function agentTriggerStyle(color: string | undefined): CSSProperties | undefined {
	if (!color) {
		return undefined;
	}
	return {
		["--agent-accent" as string]: color,
		backgroundColor: "color-mix(in oklab, var(--agent-accent) 16%, transparent)",
		color: "var(--agent-accent)",
	};
}

/**
 * Composer agent picker: shadcn DropdownMenu with the same trigger chrome as
 * the model selector.
 */
export const KiloAgentSelector: FC = () => {
	const { agent, setAgent, catalog, isCatalogPending, isCatalogError } = useChatAgentSelection();
	const displayCatalog = catalog ?? (isCatalogPending ? OPTIMISTIC_AGENT_CATALOG : undefined);
	const agents = displayCatalog?.agents ?? [];
	const selected = findCatalogAgent(displayCatalog, agent);
	const disabled = isCatalogError || agents.length === 0;
	const accent = selected?.color;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				disabled={disabled}
				style={agentTriggerStyle(accent)}
				className={cn(
					modelSelectorTriggerVariants({ variant: "ghost", size: "sm" }),
					"shrink-0",
					accent &&
						"hover:bg-[color-mix(in_oklab,var(--agent-accent)_24%,transparent)] hover:text-[var(--agent-accent)] aria-expanded:bg-[color-mix(in_oklab,var(--agent-accent)_24%,transparent)] aria-expanded:text-[var(--agent-accent)] data-popup-open:bg-[color-mix(in_oklab,var(--agent-accent)_24%,transparent)] data-popup-open:text-[var(--agent-accent)]",
				)}
				data-qa-id="kilo-agent-selector-trigger"
				aria-label="Select agent"
				aria-busy={isCatalogPending || undefined}
			>
				{selected ? (
					<span
						className={cn(
							"flex min-w-0 items-center gap-1.5",
							!accent && "dark:text-foreground/90",
						)}
					>
						<AgentIcon icon={selected.icon} size={14} />
						<span data-slot="composer-agent-label" className="whitespace-nowrap">
							{selected.displayName}
						</span>
					</span>
				) : (
					<span className="text-muted-foreground">Select agent</span>
				)}
				<ChevronDownIcon className="size-4 opacity-50" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				side="bottom"
				className="min-w-48"
				data-qa-id="kilo-agent-selector-content"
			>
				<DropdownMenuRadioGroup value={agent} onValueChange={setAgent}>
					{agents.map((entry) => (
						<DropdownMenuRadioItem
							key={entry.name}
							value={entry.name}
							closeOnClick
							data-qa-id={`kilo-agent-selector-item-${entry.name}`}
							className="gap-2"
						>
							<AgentIcon icon={entry.icon} color={entry.color} size={14} />
							<span className="truncate font-medium">{entry.displayName}</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
