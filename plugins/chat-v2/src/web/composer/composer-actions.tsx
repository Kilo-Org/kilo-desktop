import { ChevronDownIcon } from "lucide-react";
import { createContext, useContext, useState, type CSSProperties, type FC } from "react";

import type { Contribution } from "@kilo-desktop/kernel";
import { RenderContribution, useExtensions, useKernel } from "@kilo-desktop/kernel/web";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Popover, PopoverTrigger } from "@kilo-desktop/ui/components/popover";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	ComposerAction,
	type ComposerActionButton,
	type ComposerActionImplementation,
	type ComposerActionMenu,
	type ComposerActionSlot,
	type ComposerActionTrigger,
	type ComposerContext,
} from "../../contracts";
import { modelSelectorTriggerVariants } from "../selection/model-selector";
import { TooltipIconButton } from "../thread/tooltip-icon-button";

type ActionContribution = Contribution<typeof ComposerAction>;

/** What the composer's actions are told about where they are. */
export const ComposerContextContext = createContext<ComposerContext | null>(null);

export function useComposerContext(): ComposerContext {
	const context = useContext(ComposerContextContext);
	if (!context) throw new Error("A composer action needs the composer's context.");
	return context;
}

/** The actions contributed to one of the composer's slots, highest priority first. */
export const ComposerActionSlotView: FC<{ slot: ComposerActionSlot }> = ({ slot }) => {
	const context = useContext(ComposerContextContext);
	const contributions = useExtensions(ComposerAction).filter(
		(contribution) => contribution.metadata.slot === slot,
	);
	if (!context) return null;
	return (
		<>
			{contributions.map((contribution) =>
				contribution.implementation ? (
					<RenderContribution
						key={contribution.key}
						contribution={contribution}
						props={{ contribution, context }}
						select={() => ContributedAction}
					/>
				) : contribution.metadata.command ? (
					<CommandAction key={contribution.key} contribution={contribution} context={context} />
				) : null,
			)}
		</>
	);
};

interface ActionViewProps {
	readonly id: string;
	readonly title: string;
	readonly command?: string | undefined;
	readonly implementation: ComposerActionImplementation;
	readonly context: ComposerContext;
}

const ContributedAction: FC<{ contribution: ActionContribution; context: ComposerContext }> = ({
	contribution,
	context,
}) => {
	const implementation = contribution.implementation!;
	if (implementation.kind !== contribution.metadata.kind) {
		console.warn(
			`[kilo.chat] ${contribution.key} is declared a ${contribution.metadata.kind} but implemented as a ${implementation.kind}.`,
		);
		return null;
	}
	return (
		<ComposerActionView
			id={contribution.id}
			title={contribution.metadata.title}
			command={contribution.metadata.command}
			implementation={implementation}
			context={context}
		/>
	);
};

const CommandAction: FC<{ contribution: ActionContribution; context: ComposerContext }> = ({
	contribution,
	context,
}) => (
	<ComposerActionView
		id={contribution.id}
		title={contribution.metadata.title}
		command={contribution.metadata.command}
		implementation={{ kind: "action" }}
		context={context}
	/>
);

/** One action drawn as the composer draws them; also how kilo.chat's tests render its own. */
export const ComposerActionView: FC<ActionViewProps> = (props) => {
	switch (props.implementation.kind) {
		case "action":
			return <ButtonAction {...props} implementation={props.implementation} />;
		case "menu":
			return <MenuAction {...props} implementation={props.implementation} />;
		case "popover":
			return <PopoverAction {...props} implementation={props.implementation} />;
		case "view": {
			const { Component } = props.implementation;
			return <Component {...props.context} />;
		}
	}
};

type Of<K extends ComposerActionImplementation["kind"]> = Extract<
	ComposerActionImplementation,
	{ kind: K }
>;

function accentStyle(color: string | undefined): CSSProperties | undefined {
	if (!color) return undefined;
	return {
		["--agent-accent" as string]: color,
		backgroundColor: "color-mix(in oklab, var(--agent-accent) 16%, transparent)",
		color: "var(--agent-accent)",
	};
}

const ACCENT_CLASS =
	"hover:bg-[color-mix(in_oklab,var(--agent-accent)_24%,transparent)] hover:text-[var(--agent-accent)] aria-expanded:bg-[color-mix(in_oklab,var(--agent-accent)_24%,transparent)] aria-expanded:text-[var(--agent-accent)] data-popup-open:bg-[color-mix(in_oklab,var(--agent-accent)_24%,transparent)] data-popup-open:text-[var(--agent-accent)]";

const TriggerContent: FC<{ id: string; trigger: ComposerActionTrigger }> = ({ id, trigger }) => {
	const Icon = trigger.icon;
	return (
		<>
			<span className="dark:text-foreground/90 flex min-w-0 items-center gap-1.5">
				{trigger.busy ? (
					<Spinner className="size-3.5" />
				) : Icon ? (
					<Icon className="size-3.5" />
				) : null}
				{trigger.label !== undefined ? (
					<span data-slot={`composer-${id}-label`} className="whitespace-nowrap">
						{trigger.label}
					</span>
				) : null}
			</span>
			<ChevronDownIcon className="size-4 opacity-50" />
		</>
	);
};

const ButtonAction: FC<ActionViewProps & { implementation: Of<"action"> }> = (props) => {
	const { Button } = props.implementation;
	const draw = (button: ComposerActionButton) => <ActionButton {...props} button={button} />;
	if (!Button) return draw({});
	return <Button context={props.context}>{draw}</Button>;
};

const ActionButton: FC<
	ActionViewProps & { implementation: Of<"action">; button: ComposerActionButton }
> = ({ id, title, command, implementation, context, button }) => {
	const kernel = useKernel();
	if (button.hidden) return null;
	const Icon = button.icon;
	const run = () => {
		if (button.run) return button.run();
		if (implementation.run) return void implementation.run(context);
		if (command) void kernel.commands.execute(command, context);
	};
	const label = button.ariaLabel ?? title;
	if (button.label === undefined) {
		return (
			<TooltipIconButton
				tooltip={button.tooltip ?? title}
				side="bottom"
				variant="ghost"
				size="icon"
				type="button"
				disabled={button.disabled}
				aria-label={label}
				aria-busy={button.busy || undefined}
				data-qa-id={`kilo-composer-action-${id}`}
				className="aui-composer-add-attachment dark:border-border me-1 size-7 rounded-full p-1 text-xs font-semibold active:scale-[0.96] motion-reduce:transition-none"
				onClick={run}
			>
				{button.busy ? (
					<Spinner className="size-4.5" />
				) : Icon ? (
					<Icon className="size-4.5 stroke-[1.5px]" />
				) : null}
			</TooltipIconButton>
		);
	}
	return (
		<button
			type="button"
			disabled={button.disabled}
			aria-label={label}
			aria-busy={button.busy || undefined}
			title={button.tooltip}
			data-qa-id={`kilo-composer-action-${id}`}
			style={accentStyle(button.color)}
			className={cn(
				modelSelectorTriggerVariants({ variant: "ghost", size: "sm" }),
				"shrink-0",
				button.color && ACCENT_CLASS,
			)}
			onClick={run}
		>
			<span className="dark:text-foreground/90 flex min-w-0 items-center gap-1.5">
				{Icon ? <Icon className="size-3.5" /> : null}
				<span data-slot={`composer-${id}-label`} className="whitespace-nowrap">
					{button.label}
				</span>
			</span>
		</button>
	);
};

const MenuAction: FC<ActionViewProps & { implementation: Of<"menu"> }> = ({
	id,
	title,
	implementation,
	context,
}) => {
	const { Menu } = implementation;
	return (
		<Menu context={context}>{(menu) => <ActionMenu id={id} title={title} menu={menu} />}</Menu>
	);
};

const ActionMenu: FC<{ id: string; title: string; menu: ComposerActionMenu }> = ({
	id,
	title,
	menu,
}) => {
	if (menu.hidden) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				disabled={menu.disabled}
				style={accentStyle(menu.color)}
				className={cn(
					modelSelectorTriggerVariants({ variant: "ghost", size: "sm" }),
					"shrink-0",
					menu.color && ACCENT_CLASS,
				)}
				data-qa-id={`kilo-${id}-selector-trigger`}
				aria-label={menu.ariaLabel ?? title}
				aria-busy={menu.busy || undefined}
				title={menu.tooltip}
			>
				<TriggerContent id={id} trigger={{ ...menu, busy: false }} />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align={menu.align ?? "start"}
				side="bottom"
				data-qa-id={`kilo-${id}-selector-content`}
			>
				<DropdownMenuRadioGroup
					{...(menu.value === undefined ? {} : { value: menu.value })}
					onValueChange={(value) => menu.select(String(value))}
				>
					{menu.items.map((item) => {
						const Icon = item.icon;
						return (
							<DropdownMenuRadioItem
								key={item.id}
								value={item.id}
								closeOnClick
								disabled={item.disabled}
								data-qa-id={`kilo-${id}-selector-item-${item.id}`}
								className="gap-2"
							>
								{Icon ? (
									<span className="flex shrink-0 items-center justify-center" aria-hidden>
										<Icon
											className="size-3.5"
											{...(item.color ? { style: { color: item.color } } : {})}
										/>
									</span>
								) : null}
								<span className="truncate font-medium whitespace-nowrap">{item.label}</span>
								{item.description ? (
									<span className="text-muted-foreground min-w-0 truncate text-xs">
										{item.description}
									</span>
								) : null}
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

const PopoverAction: FC<ActionViewProps & { implementation: Of<"popover"> }> = (props) => {
	const { Trigger } = props.implementation;
	const draw = (trigger: ComposerActionTrigger) => <ActionPopover {...props} trigger={trigger} />;
	if (!Trigger) return draw({});
	return <Trigger context={props.context}>{draw}</Trigger>;
};

const ActionPopover: FC<
	ActionViewProps & { implementation: Of<"popover">; trigger: ComposerActionTrigger }
> = ({ id, title, implementation, context, trigger }) => {
	const [open, setOpen] = useState(false);
	if (trigger.hidden) return null;
	const { Content } = implementation;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				disabled={trigger.disabled}
				style={accentStyle(trigger.color)}
				className={cn(
					modelSelectorTriggerVariants({ variant: "ghost", size: "sm" }),
					"min-w-0",
					trigger.color && ACCENT_CLASS,
				)}
				data-qa-id={`kilo-${id}-selector-trigger`}
				aria-label={trigger.ariaLabel ?? title}
				aria-busy={trigger.busy || undefined}
				title={trigger.tooltip}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						setOpen(true);
					}
				}}
			>
				<TriggerContent id={id} trigger={{ ...trigger, busy: false }} />
			</PopoverTrigger>
			<Content {...context} open={open} close={() => setOpen(false)} />
		</Popover>
	);
};
