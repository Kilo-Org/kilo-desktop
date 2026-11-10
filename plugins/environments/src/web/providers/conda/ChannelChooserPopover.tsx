import { ListFilterIcon } from "lucide-react";

import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";

import { getChannelPresentation } from "./channel-presentation";

interface ChannelChooserPopoverProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Short scope label, e.g. "All channels"; announced on the trigger. */
	summary: string;
	/** True when the selection differs from the default channel set. */
	customized: boolean;
	qaId?: string;
	availableChannels: string[];
	selectedChannels: string[];
	onToggle: (channel: string) => void;
}

/**
 * Channel picker for package search, rendered as the toolbar filter button
 * used beside other search inputs. Every offered channel toggles freely with
 * no sign-in step; channels backed by an Anaconda API key fail at fetch time
 * with a handled error.
 */
export function ChannelChooserPopover({
	open,
	onOpenChange,
	summary,
	customized,
	qaId,
	availableChannels,
	selectedChannels,
	onToggle,
}: ChannelChooserPopoverProps) {
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant={customized ? "secondary" : "outline"}
						size="icon"
						aria-label={`Channels: ${summary}`}
						className="shrink-0"
						data-active={customized || undefined}
						data-qa-id={qaId}
					/>
				}
			>
				<ListFilterIcon aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72" data-qa-id="environments-channel-chooser">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Channels</DropdownMenuLabel>
					{availableChannels.map((channel) => {
						const presentation = getChannelPresentation(channel);
						const selected = selectedChannels.includes(channel);
						return (
							<DropdownMenuCheckboxItem
								key={channel}
								checked={selected}
								closeOnClick={false}
								onCheckedChange={() => onToggle(channel)}
								data-qa-id={`environments-channel-option-${channel}`}
							>
								<span className="flex min-w-0 flex-col gap-0.5">
									<span className="flex min-w-0 items-center gap-1.5">
										<span className="truncate">{presentation.title}</span>
										{presentation.badge ? (
											<Badge variant="secondary" className="shrink-0">
												{presentation.badge}
											</Badge>
										) : null}
									</span>
									<span className="text-muted-foreground text-xs leading-snug">
										{presentation.description}
									</span>
								</span>
							</DropdownMenuCheckboxItem>
						);
					})}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
