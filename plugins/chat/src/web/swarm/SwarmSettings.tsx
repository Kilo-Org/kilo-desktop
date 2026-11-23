import { useState } from "react";
import { MessagesSquareIcon } from "lucide-react";

import type { DomainObjectState, PluginSdk } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Swarm } from "@kilo-desktop/plugin-core/contracts";
import { Navigation, SettingsSection } from "@kilo-desktop/plugin-shell/contracts";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { Switch } from "@kilo-desktop/ui/components/switch";

import { useSwarmPreferences, type SwarmAutoOpen } from "./swarm-preferences";

/** The section's `kilo.shell/settings-section` contribution id (see plugin.json). */
export const SWARM_SETTINGS_SECTION = "swarm-board";

/** Settings → Notifications, where kilo.work-sessions keeps the "needs you" cue subagents raise too. */
const NOTIFICATION_SETTINGS_SECTION = "kilo.work-sessions/notifications";

const AUTO_OPEN: { value: SwarmAutoOpen; label: string }[] = [
	{ value: "never", label: "Never" },
	{ value: "three", label: "Only for 3+ agents" },
	{ value: "always", label: "Always" },
];

const selectEnabled = (state: DomainObjectState<typeof Swarm>) => state.enabled;

/** Binds Settings → Swarm Board in this window. */
export function implementSwarmSettings(sdk: PluginSdk): void {
	sdk.extensions.implement(SettingsSection, SWARM_SETTINGS_SECTION, {
		component: SwarmSettings,
		icon: MessagesSquareIcon,
	});
}

/**
 * Settings → Swarm Board: Kilo's own `shared_agent_board` switch (through
 * kilo.core/swarm, so the Kilo CLI and VS Code share it) and this device's
 * board preferences.
 */
export function SwarmSettings() {
	const swarm = useDomainObject(Swarm);
	const enabled = useDomainObjectState(Swarm, selectEnabled) ?? null;
	const navigation = useDomainObject(Navigation);
	const autoOpen = useSwarmPreferences((state) => state.autoOpen);
	const shelf = useSwarmPreferences((state) => state.shelf);
	const setPreferences = useSwarmPreferences((state) => state.set);
	const [saving, setSaving] = useState<boolean | null>(null);

	const save = async (next: boolean) => {
		if (!swarm) return;
		setSaving(next);
		try {
			await swarm.methods.setEnabled({ enabled: next });
		} catch (error) {
			toast.error("Could not change the Swarm Board setting", {
				description: error instanceof Error ? error.message : undefined,
			});
		}
		setSaving(null);
	};

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="swarm-settings">
			<SettingsPageHeader />
			<section className="border-border bg-card min-w-0 overflow-hidden rounded-lg border">
				<SummaryCard.Row>
					<SummaryCard.Content>
						<SummaryCard.Title className="flex items-center gap-2">
							<label htmlFor="swarm-board-enabled">Swarm Board</label>
							<Badge variant="secondary">Preview</Badge>
						</SummaryCard.Title>
						<SummaryCard.Description className="line-clamp-none">
							Let delegated agents coordinate on a shared board you can watch live. Useful for
							large, multi-part tasks.
						</SummaryCard.Description>
						<SummaryCard.Description className="text-muted-foreground line-clamp-none text-xs">
							When off, subagents run as they do today: they report back to the main agent and
							appear as collapsed steps in chat. This is Kilo&apos;s{" "}
							<code className="bg-muted rounded-sm px-1">shared_agent_board</code> setting, shared
							with the Kilo CLI and VS Code.
						</SummaryCard.Description>
					</SummaryCard.Content>
					<SummaryCard.Actions>
						<Switch
							id="swarm-board-enabled"
							data-qa-id="swarm-board-enabled"
							checked={saving ?? enabled ?? false}
							disabled={enabled === null || saving !== null}
							onCheckedChange={(next) => void save(next)}
						/>
					</SummaryCard.Actions>
				</SummaryCard.Row>
			</section>
			<section className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border">
				<SummaryCard.Row>
					<SummaryCard.Content>
						<SummaryCard.Title>
							<label htmlFor="swarm-board-auto-open">Open the board automatically</label>
						</SummaryCard.Title>
						<SummaryCard.Description>
							Open beside the chat when a swarm starts.
						</SummaryCard.Description>
					</SummaryCard.Content>
					<SummaryCard.Actions>
						<Select
							value={autoOpen}
							items={AUTO_OPEN}
							onValueChange={(next) => {
								if (next) setPreferences({ autoOpen: next });
							}}
						>
							<SelectTrigger
								id="swarm-board-auto-open"
								aria-label="Open the board automatically"
								className="w-52"
								data-qa-id="swarm-board-auto-open"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{AUTO_OPEN.map((option) => (
										<SelectItem
											key={option.value}
											value={option.value}
											data-qa-id={`swarm-board-auto-open-${option.value}`}
										>
											{option.label}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</SummaryCard.Actions>
				</SummaryCard.Row>
				<SummaryCard.Row>
					<SummaryCard.Content>
						<SummaryCard.Title>Notify me when an agent needs me</SummaryCard.Title>
						<SummaryCard.Description>
							System notification when Kilo isn&apos;t focused.
						</SummaryCard.Description>
					</SummaryCard.Content>
					<SummaryCard.Actions>
						<Button
							variant="outline"
							size="sm"
							disabled={!navigation}
							onClick={() =>
								void navigation?.methods
									.openSettings({ section: NOTIFICATION_SETTINGS_SECTION })
									.catch(() => undefined)
							}
							data-qa-id="swarm-board-notification-settings"
						>
							Notification settings
						</Button>
					</SummaryCard.Actions>
				</SummaryCard.Row>
				<SummaryCard.Row>
					<SummaryCard.Content>
						<SummaryCard.Title>
							<label htmlFor="swarm-board-shelf">Show swarm shelf on the composer</label>
						</SummaryCard.Title>
						<SummaryCard.Description>
							Live roster and latest post above the message box.
						</SummaryCard.Description>
					</SummaryCard.Content>
					<SummaryCard.Actions>
						<Switch
							id="swarm-board-shelf"
							data-qa-id="swarm-board-shelf"
							checked={shelf}
							onCheckedChange={(next) => setPreferences({ shelf: next })}
						/>
					</SummaryCard.Actions>
				</SummaryCard.Row>
			</section>
		</div>
	);
}
