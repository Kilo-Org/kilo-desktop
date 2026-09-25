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

import { getChannelPresentation } from "./channel-presentation.js";

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
	/** True when the user already has an Anaconda session. */
	signedIn: boolean;
	/** Fired when an Anaconda channel is picked while signed out. */
	onRequestSignIn: (channel: string) => void;
}

/**
 * Channel picker for package search, rendered as the toolbar filter button
 * used beside other search inputs. Anaconda channels stay clickable while
 * signed out but route through `onRequestSignIn`; conda-forge and custom
 * channels toggle freely.
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
	signedIn,
	onRequestSignIn,
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
						const gated = presentation.requiresSignIn && !signedIn;
						return (
							<DropdownMenuCheckboxItem
								key={channel}
								checked={selected}
								closeOnClick={false}
								onCheckedChange={() => (gated ? onRequestSignIn(channel) : onToggle(channel))}
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
