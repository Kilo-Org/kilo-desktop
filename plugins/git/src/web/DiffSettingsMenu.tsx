import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";
import { SettingsIcon } from "lucide-react";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";

import type { DiffIndicators } from "@pierre/diffs";

import { useDiffOptions, type DiffStyle } from "./diff-options.js";

export function DiffSettingsMenu() {
	const [{ diffIndicators, diffStyle, showBackgrounds, showLineNumbers, wrapLines }, setOpt] =
		useDiffOptions();
	const setDiffStyle = (value: DiffStyle) => setOpt("diffStyle", value);
	const setIndicators = (value: DiffIndicators) => setOpt("diffIndicators", value);
	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger
					render={
						<DropdownMenuTrigger
							render={
								<Button
									aria-label="Diff settings"
									data-qa-id="git-diff-settings"
									type="button"
									size="icon-sm"
									variant="ghost"
								/>
							}
						/>
					}
				>
					<SettingsIcon />
				</TooltipTrigger>
				<TooltipContent side="bottom">Diff settings</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Layout</DropdownMenuLabel>
					<DropdownMenuRadioGroup value={diffStyle} onValueChange={setDiffStyle}>
						<DropdownMenuRadioItem value="unified" data-qa-id="git-diff-settings-layout-unified">
							Unified
						</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="split" data-qa-id="git-diff-settings-layout-split">
							Split
						</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuLabel>Indicators</DropdownMenuLabel>
					<DropdownMenuRadioGroup value={diffIndicators} onValueChange={setIndicators}>
						<DropdownMenuRadioItem value="bars" data-qa-id="git-diff-settings-indicators-bars">
							Bars
						</DropdownMenuRadioItem>
						<DropdownMenuRadioItem
							value="classic"
							data-qa-id="git-diff-settings-indicators-classic"
						>
							Classic
						</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="none" data-qa-id="git-diff-settings-indicators-none">
							None
						</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuCheckboxItem
						checked={wrapLines}
						data-qa-id="git-diff-settings-wrap"
						onCheckedChange={(checked) => setOpt("wrapLines", checked === true)}
					>
						Wrap long lines
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem
						checked={showBackgrounds}
						data-qa-id="git-diff-settings-backgrounds"
						onCheckedChange={(checked) => setOpt("showBackgrounds", checked === true)}
					>
						Backgrounds
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem
						checked={showLineNumbers}
						data-qa-id="git-diff-settings-line-numbers"
						onCheckedChange={(checked) => setOpt("showLineNumbers", checked === true)}
					>
						Line numbers
					</DropdownMenuCheckboxItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
