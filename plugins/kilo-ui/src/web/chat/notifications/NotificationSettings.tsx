import { Volume2Icon } from "lucide-react";

import { SettingsPageHeader } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";

import type { ChatCue } from "./chat-notifier.js";
import { useNotificationPreferences, type NotificationMode } from "./notification-preferences.js";
import { playNotificationSound } from "./notification-sounds.js";

const MODES: { value: NotificationMode; label: string }[] = [
	{ value: "off", label: "Never" },
	{ value: "smart", label: "When I'm not looking" },
	{ value: "always", label: "Always" },
];

const CUES: { cue: ChatCue; title: string; description: string }[] = [
	{ cue: "done", title: "When Kilo finishes", description: "Kilo completed its turn." },
	{
		cue: "needsYou",
		title: "When Kilo needs you",
		description: "An approval, a question, or an error.",
	},
];

/** Per-cue notification modes (stored per device in localStorage). */
export function NotificationSettings() {
	const preferences = useNotificationPreferences();

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="notification-settings">
			<SettingsPageHeader />
			<section className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border">
				{CUES.map(({ cue, title, description }) => (
					<div key={cue}>
						<SummaryCard.Row>
							<SummaryCard.Content>
								<SummaryCard.Title>
									<label htmlFor={`notification-mode-${cue}`}>{title}</label>
								</SummaryCard.Title>
								<SummaryCard.Description>{description}</SummaryCard.Description>
							</SummaryCard.Content>
							<SummaryCard.Actions>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Preview sound ${title.toLowerCase()}`}
									onClick={() => playNotificationSound(cue)}
									data-qa-id={`notification-preview-${cue}`}
								>
									<Volume2Icon aria-hidden="true" />
								</Button>
								<Select
									value={preferences[cue]}
									items={MODES}
									onValueChange={(mode) => {
										if (mode) preferences.setMode(cue, mode);
									}}
								>
									<SelectTrigger
										id={`notification-mode-${cue}`}
										aria-label={title}
										className="w-52"
										data-qa-id={`notification-mode-${cue}`}
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{MODES.map((mode) => (
												<SelectItem
													key={mode.value}
													value={mode.value}
													data-qa-id={`notification-mode-${cue}-${mode.value}`}
												>
													{mode.label}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</SummaryCard.Actions>
						</SummaryCard.Row>
					</div>
				))}
			</section>
		</div>
	);
}
