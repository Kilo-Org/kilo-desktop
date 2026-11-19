import { ChevronDownIcon, CircleQuestionMarkIcon, SearchIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { BOARD_MESSAGE_TYPES, type BoardMessageType } from "@kilo-desktop/plugin-core/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@kilo-desktop/ui/components/input-group";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	EMPTY_FILTER,
	isFiltering,
	type BoardFilter,
	type FilterDirection,
} from "./board-insights";
import { MessageTypeLabel } from "./board-posts";

export interface FilterAgent {
	/** A team member's chat id; `main` for the main agent. */
	readonly id: string;
	readonly name: string;
	readonly color: string;
}

const toggle = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
	const next = new Set(set);
	if (next.has(value)) next.delete(value);
	else next.add(value);
	return next;
};

const DIRECTIONS: { value: FilterDirection; label: string }[] = [
	{ value: "both", label: "From or to them" },
	{ value: "from", label: "From them" },
	{ value: "to", label: "To them" },
	{ value: "between", label: "Between them" },
];

/** What a menu's trigger says it shows: "All", the one choice, or how many. */
function summary(names: readonly string[]): string {
	if (names.length === 0) return "All";
	if (names.length === 1) return names[0]!;
	return `${names.length} selected`;
}

/** A filter menu's trigger: its name and what it is set to, emphasised while it narrows the board. */
function FilterTrigger({
	label,
	value,
	active,
	qaId,
	children,
}: {
	readonly label: string;
	readonly value: string;
	readonly active: boolean;
	readonly qaId: string;
	readonly children?: ReactNode;
}) {
	return (
		<DropdownMenuTrigger
			render={
				<Button
					variant={active ? "secondary" : "outline"}
					size="xs"
					className="max-w-52 gap-1"
					aria-label={`${label}: ${value}`}
				/>
			}
			data-qa-id={qaId}
		>
			<span className={cn("shrink-0", !active && "text-muted-foreground")}>{label}</span>
			<span className="min-w-0 truncate font-medium">{value}</span>
			{children}
			<ChevronDownIcon aria-hidden data-icon="inline-end" />
		</DropdownMenuTrigger>
	);
}

/**
 * Narrows loaded posts: a search, then message types (including posts
 * without a reply), and team members (what they said,
 * were told, or both). Each menu takes several choices; filters combine.
 */
export function BoardFilterBar({
	filter,
	onChange,
	agents,
	counts,
	openCount,
	shown,
	total,
	hasMore = false,
}: {
	readonly filter: BoardFilter;
	readonly onChange: (filter: BoardFilter) => void;
	readonly agents: readonly FilterAgent[];
	readonly counts: Record<BoardMessageType, number>;
	readonly openCount: number;
	readonly shown: number;
	readonly total: number;
	readonly hasMore?: boolean;
}) {
	const filtering = isFiltering(filter);
	const typeNames = [
		...(filter.openOnly ? ["No reply yet"] : []),
		...BOARD_MESSAGE_TYPES.filter((type) => filter.types.has(type)),
	];
	const agentNames = agents
		.filter((agent) => filter.agents.has(agent.id))
		.map((agent) => agent.name);

	return (
		<div
			className="border-border flex flex-wrap items-center gap-2 border-b py-2"
			data-qa-id="swarm-board-filters"
		>
			<InputGroup className="min-w-32 flex-1">
				<InputGroupInput
					value={filter.query}
					placeholder="Search loaded messages"
					aria-label="Search loaded messages"
					data-qa-id="swarm-board-search"
					onChange={(event) => onChange({ ...filter, query: event.target.value })}
				/>
				<InputGroupAddon>
					<SearchIcon aria-hidden />
				</InputGroupAddon>
				{filter.query ? (
					<InputGroupAddon align="inline-end">
						<InputGroupButton
							size="icon-xs"
							aria-label="Clear search"
							onClick={() => onChange({ ...filter, query: "" })}
						>
							<XIcon />
						</InputGroupButton>
					</InputGroupAddon>
				) : null}
			</InputGroup>

			<DropdownMenu>
				<FilterTrigger
					label="Type"
					value={summary(typeNames)}
					active={typeNames.length > 0}
					qaId="swarm-board-filter-type-menu"
				>
					{openCount > 0 && !filter.openOnly ? (
						<span
							className="bg-warning size-1.5 shrink-0 rounded-full"
							title={`${openCount} with no reply yet`}
						/>
					) : null}
				</FilterTrigger>
				<DropdownMenuContent
					align="start"
					className="w-60"
					data-qa-id="swarm-board-filter-type-list"
				>
					<DropdownMenuGroup>
						<DropdownMenuCheckboxItem
							checked={filter.openOnly}
							closeOnClick={false}
							onCheckedChange={(checked) => onChange({ ...filter, openOnly: checked === true })}
							data-qa-id="swarm-board-filter-open"
						>
							<CircleQuestionMarkIcon aria-hidden className="text-warning-foreground" />
							No reply yet
							<span className="text-muted-foreground ms-auto tabular-nums">{openCount}</span>
						</DropdownMenuCheckboxItem>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuLabel>Message types</DropdownMenuLabel>
						{BOARD_MESSAGE_TYPES.map((type) => (
							<DropdownMenuCheckboxItem
								key={type}
								checked={filter.types.has(type)}
								closeOnClick={false}
								onCheckedChange={() => onChange({ ...filter, types: toggle(filter.types, type) })}
								data-qa-id={`swarm-board-filter-type-${type}`}
							>
								<MessageTypeLabel type={type} />
								<span className="text-muted-foreground ms-auto tabular-nums">{counts[type]}</span>
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuGroup>
					{typeNames.length > 0 ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								<DropdownMenuItem
									onClick={() => onChange({ ...filter, types: new Set(), openOnly: false })}
								>
									Show every type
								</DropdownMenuItem>
							</DropdownMenuGroup>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>

			<DropdownMenu>
				<FilterTrigger
					label="Agents"
					value={summary(agentNames)}
					active={agentNames.length > 0}
					qaId="swarm-board-filter-agent-menu"
				/>
				<DropdownMenuContent
					align="start"
					className="w-64"
					data-qa-id="swarm-board-filter-agent-list"
				>
					<DropdownMenuGroup>
						<DropdownMenuLabel>Agents</DropdownMenuLabel>
						{agents.map((agent) => (
							<DropdownMenuCheckboxItem
								key={agent.id}
								checked={filter.agents.has(agent.id)}
								closeOnClick={false}
								onCheckedChange={() => {
									const selected = toggle(filter.agents, agent.id);
									onChange({
										...filter,
										agents: selected,
										direction:
											filter.direction === "between" && selected.size < 2
												? "both"
												: filter.direction,
									});
								}}
								data-qa-id="swarm-board-filter-agent"
							>
								<span
									aria-hidden
									className="size-2 shrink-0 rounded-full"
									style={{ backgroundColor: agent.color }}
								/>
								<span className="truncate">{agent.name}</span>
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuLabel>Posts</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							value={filter.direction}
							onValueChange={(value) =>
								onChange({ ...filter, direction: value as FilterDirection })
							}
						>
							{DIRECTIONS.map((direction) => (
								<DropdownMenuRadioItem
									key={direction.value}
									value={direction.value}
									closeOnClick={false}
									disabled={filter.agents.size < (direction.value === "between" ? 2 : 1)}
									title={
										direction.value === "between" && filter.agents.size < 2
											? "Select at least two agents"
											: undefined
									}
									data-qa-id={`swarm-board-filter-direction-${direction.value}`}
								>
									{direction.label}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
						{filter.agents.size < 2 ? (
							<p className="text-muted-foreground px-2 py-1 text-xs">
								Select at least two agents for Between.
							</p>
						) : null}
					</DropdownMenuGroup>
					{agentNames.length > 0 ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								<DropdownMenuItem
									onClick={() => onChange({ ...filter, agents: new Set(), direction: "both" })}
								>
									Show every agent
								</DropdownMenuItem>
							</DropdownMenuGroup>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>

			<span className="text-muted-foreground flex w-full flex-wrap items-center gap-2 text-xs">
				<span data-qa-id="swarm-board-filter-count">
					{filtering ? `${shown} of ${total}` : total} loaded {total === 1 ? "message" : "messages"}
				</span>
				{hasMore ? <span>Older messages are not searched.</span> : null}
				{filtering ? (
					<Button
						size="xs"
						variant="ghost"
						className="ms-auto"
						data-qa-id="swarm-board-filter-clear"
						onClick={() => onChange(EMPTY_FILTER)}
					>
						Clear
					</Button>
				) : null}
			</span>
		</div>
	);
}
