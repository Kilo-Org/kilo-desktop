import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { KernelDataCollection, KernelOs } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Alert, AlertDescription, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { ExternalLink } from "@kilo-desktop/ui/components/external-link";
import { FieldError } from "@kilo-desktop/ui/components/field";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import { Skeleton, SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { Switch } from "@kilo-desktop/ui/components/switch";

const FREE_MODELS_DATA_HANDLING_URL = "https://kilo.ai/docs/getting-started/using-kilo-for-free";

const selectChoice = (state: { choice: boolean }) => state.choice;

/**
 * Settings → Privacy. Shows the saved choice, not effective consent: builds
 * that force collection off (e2e) must still let the toggle round-trip.
 */
export function PrivacySettings() {
	const dataCollection = useDomainObject(KernelDataCollection);
	const choice = useDomainObjectState(KernelDataCollection, selectChoice);
	const os = useDomainObject(KernelOs);
	const [pending, setPending] = useState<boolean | null>(null);
	const [error, setError] = useState<string | null>(null);

	const save = async (allowed: boolean) => {
		if (!dataCollection) return;
		setPending(allowed);
		setError(null);
		try {
			await dataCollection.methods.setChoice({ allowed });
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not update privacy settings. Retry the change.",
			);
		}
		setPending(null);
	};

	return (
		<div className="flex min-w-0 flex-col gap-6">
			<SettingsPageHeader />
			<div className="min-w-0" data-qa-id="privacy-settings">
				<div className="bg-card min-w-0 overflow-hidden rounded-lg border">
					{choice === undefined ? (
						<SummaryCard.Row role="status" aria-busy="true" aria-label="Loading privacy settings">
							<SummaryCard.Content>
								<SummaryCard.Title>
									<SkeletonText className="w-64" />
								</SummaryCard.Title>
								<SummaryCard.Description>
									<SkeletonText className="w-48" />
								</SummaryCard.Description>
							</SummaryCard.Content>
							<SummaryCard.Actions>
								<Skeleton className="h-[18.4px] w-8 rounded-full" />
							</SummaryCard.Actions>
						</SummaryCard.Row>
					) : (
						<div className="divide-border divide-y">
							<SummaryCard.Row>
								<SummaryCard.Content>
									<SummaryCard.Title>
										<label htmlFor="privacy-data-collection">
											Share usage analytics and crash reports
										</label>
									</SummaryCard.Title>
									<SummaryCard.Description className="line-clamp-none">
										Includes the embedded Kilo service and conda environment manager. Chat, sign-in,
										and updates still use the network.
									</SummaryCard.Description>
								</SummaryCard.Content>
								<SummaryCard.Actions>
									<Switch
										id="privacy-data-collection"
										data-qa-id="privacy-data-collection"
										checked={pending ?? choice}
										onCheckedChange={(allowed) => void save(allowed)}
									/>
								</SummaryCard.Actions>
							</SummaryCard.Row>
							{error ? <FieldError className="px-3 py-3 text-sm">{error}</FieldError> : null}
						</div>
					)}
				</div>
				<Alert className="mt-4" data-qa-id="privacy-free-models-note">
					<TriangleAlertIcon aria-hidden="true" className="text-amber-500" />
					<AlertTitle>Data handling for free models</AlertTitle>
					<AlertDescription>
						Free models may route your requests to providers that log prompts and outputs and use
						them to improve their services. Do not submit personal or confidential data when using
						free models. Learn more about data handling for free models{" "}
						<ExternalLink
							href={FREE_MODELS_DATA_HANDLING_URL}
							onOpen={(url) => void os?.methods.openExternal({ url }).catch(() => undefined)}
						>
							here
						</ExternalLink>
						. You can use the chat model picker filter to exclude free models.
					</AlertDescription>
				</Alert>
			</div>
		</div>
	);
}
