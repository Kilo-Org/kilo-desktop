import { useKernel } from "@kilo-desktop/kernel/web";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";

import { useSendKey, useSetSendKey, type SendKey } from "../composer/send-key";

/** Settings → Chat: the composer's send key. */
export function ChatSettings() {
	const { platform } = useKernel().keyboard;
	const sendKey = useSendKey();
	const setSendKey = useSetSendKey();
	const keys: { value: SendKey; label: string }[] = [
		{ value: "enter", label: "Enter" },
		{ value: "ctrlEnter", label: platform === "mac" ? "⌘ + Enter" : "Ctrl + Enter" },
	];

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="chat-settings">
			<SettingsPageHeader />
			<section className="border-border bg-card min-w-0 overflow-hidden rounded-lg border">
				<SummaryCard.Row>
					<SummaryCard.Content>
						<SummaryCard.Title>
							<label htmlFor="chat-send-key">Send with</label>
						</SummaryCard.Title>
						<SummaryCard.Description>
							{sendKey === "enter" ? "Shift+Enter" : "Enter"} adds a new line.
						</SummaryCard.Description>
					</SummaryCard.Content>
					<SummaryCard.Actions>
						<Select
							value={sendKey}
							items={keys}
							disabled={!setSendKey}
							onValueChange={(value) => {
								if (value) setSendKey?.(value);
							}}
						>
							<SelectTrigger
								id="chat-send-key"
								aria-label="Send with"
								className="w-40"
								data-qa-id="chat-send-key"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{keys.map((key) => (
										<SelectItem
											key={key.value}
											value={key.value}
											data-qa-id={`chat-send-key-${key.value}`}
										>
											{key.label}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</SummaryCard.Actions>
				</SummaryCard.Row>
			</section>
		</div>
	);
}
