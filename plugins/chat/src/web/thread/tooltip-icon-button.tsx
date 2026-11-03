"use client";

import { type ComponentPropsWithRef, forwardRef } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { Button } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";

export type TooltipIconButtonProps = ComponentPropsWithRef<typeof Button> & {
	tooltip: string;
	side?: "top" | "bottom" | "left" | "right";
};

export const TooltipIconButton = forwardRef<HTMLButtonElement, TooltipIconButtonProps>(
	({ children, tooltip, side = "bottom", className, ...rest }, ref) => {
		return (
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-xs"
							{...rest}
							className={cn("aui-button-icon active:scale-90", className)}
							ref={ref}
						/>
					}
				>
					{children}
					<span className="aui-sr-only sr-only">{tooltip}</span>
				</TooltipTrigger>
				<TooltipContent side={side}>{tooltip}</TooltipContent>
			</Tooltip>
		);
	},
);

TooltipIconButton.displayName = "TooltipIconButton";
