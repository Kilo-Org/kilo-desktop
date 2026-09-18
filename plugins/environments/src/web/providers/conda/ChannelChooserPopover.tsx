import { CheckIcon } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@kilo-desktop/ui/components/popover";

import { getChannelPresentation } from "./channel-presentation.js";

interface ChannelChooserPopoverProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger: Omit<ComponentPropsWithoutRef<"button">, "type" | "variant"> & {
		"data-qa-id"?: string | undefined;
	};
	availableChannels: string[];
	selectedChannels: string[];
	onToggle: (channel: string) => void;
	/** True when the user already has an Anaconda session. */
	signedIn: boolean;
	/** Fired when an Anaconda channel is picked while signed out. */
	onRequestSignIn: (channel: string) => void;
}

/**
 * Channel picker popover for environment creation, rendered as option cards
 * per configured channel. Anaconda channels stay clickable while signed out
 * but route through `onRequestSignIn` so the feature can gate them behind
 * the shared sign-in modal; conda-forge and custom channels toggle freely.
 */
export function ChannelChooserPopover({
	open,
	onOpenChange,
	trigger,
	availableChannels,
	selectedChannels,
	onToggle,
	signedIn,
	onRequestSignIn,
}: ChannelChooserPopoverProps) {
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger render={<Button type="button" variant="outline" {...trigger} />} />
			<PopoverContent
				align="end"
				className="w-[28rem] gap-3 p-4"
				data-qa-id="environments-channel-chooser"
			>
				<p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
					Choose a channel
				</p>
				<div className="flex flex-col">
					{availableChannels.map((channel) => {
						const presentation = getChannelPresentation(channel);
						const selected = selectedChannels.includes(channel);
						const gated = presentation.requiresSignIn && !signedIn;
						return (
							<button
								key={channel}
								type="button"
								role="checkbox"
								aria-checked={selected}
								aria-label={presentation.title}
								data-qa-id={`environments-channel-option-${channel}`}
								className="hover:bg-accent/50 focus-visible:ring-ring/50 flex items-start gap-3 rounded-lg p-2.5 text-left outline-none focus-visible:ring-3"
								onClick={() => (gated ? onRequestSignIn(channel) : onToggle(channel))}
							>
								<span
									aria-hidden="true"
									className={cn(
										"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
										selected
											? "border-primary bg-primary text-primary-foreground"
											: "border-muted-foreground/60",
									)}
								>
									{selected ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
								</span>
								<span className="flex min-w-0 flex-col gap-0.5">
									<span className="flex items-center gap-2 text-sm font-semibold">
										{presentation.title}
										{presentation.badge ? (
											<Badge variant="secondary" className="px-1.5 text-[0.65rem]">
												{presentation.badge}
											</Badge>
										) : null}
									</span>
									<span className="text-muted-foreground text-sm leading-snug">
										{presentation.description}
									</span>
								</span>
							</button>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}
