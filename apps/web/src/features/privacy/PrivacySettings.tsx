import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
	PRIVACY_CHANGED_EVENT,
	PRIVACY_FEATURE_ID,
	type PrivacyService,
} from "@kilo-desktop/contracts";
import {
	SettingsPageHeader,
	sdkQueryKey,
	useSdk,
	useSdkMutation,
	useSdkQuery,
} from "@kilo-desktop/sdk-react";
import { FieldError } from "@kilo-desktop/ui/components/field";
import { Skeleton, SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { Switch } from "@kilo-desktop/ui/components/switch";

export function PrivacySettings() {
	const sdk = useSdk<PrivacyService>(PRIVACY_FEATURE_ID);
	const queryClient = useQueryClient();
	const settings = useSdkQuery(sdk, "get");
	const save = useSdkMutation(sdk, "set", { invalidates: ["get"] });

	// Another window, or a failed withdrawal, can change the authoritative preference.
	useEffect(
		() =>
			sdk.events.on(PRIVACY_CHANGED_EVENT, () => {
				void queryClient.invalidateQueries({ queryKey: sdkQueryKey(sdk, "get") });
			}),
		[queryClient, sdk],
	);

	const error = settings.error?.message ?? save.error?.message;
	const allowDataCollection = save.isPending
		? save.variables.allowDataCollection
		: (settings.data?.allowDataCollection ?? false);

	return (
		<div className="flex min-w-0 flex-col gap-6">
			<SettingsPageHeader />
			<div className="min-w-0" data-qa-id="privacy-settings">
				<div className="bg-card min-w-0 overflow-hidden rounded-lg border">
					{settings.isPending ? (
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
									<SummaryCard.Description>
										Includes the embedded Kilo service. Chat, sign-in, and updates still use the
										network.
									</SummaryCard.Description>
								</SummaryCard.Content>
								<SummaryCard.Actions>
									<Switch
										id="privacy-data-collection"
										data-qa-id="privacy-data-collection"
										checked={allowDataCollection}
										disabled={settings.isError}
										onCheckedChange={(allowDataCollection) => {
											save.mutate({ allowDataCollection });
										}}
									/>
								</SummaryCard.Actions>
							</SummaryCard.Row>
							{error ? <FieldError className="px-3 py-3 text-sm">{error}</FieldError> : null}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
