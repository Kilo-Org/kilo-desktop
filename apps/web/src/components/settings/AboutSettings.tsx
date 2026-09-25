import { useState } from "react";

import type { DesktopUpdateState } from "@kilo-desktop/contracts";
import { SettingsPageHeader } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import { SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { FieldLegend, FieldSet } from "@kilo-desktop/ui/components/field";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { hasVisibleReleaseNotes, ReleaseNotesList } from "@/components/updates/ReleaseNotesList";
import { InstallUpdateDialog } from "@/components/updates/InstallUpdateDialog";
import { useDesktopUpdates } from "@/platform/updates/UpdateProvider";

export function AboutSettings() {
	const updates = useDesktopUpdates();
	const state = updates?.state;
	const targetRelease = state?.releaseNotes.find(hasVisibleReleaseNotes);
	const [pending, setPending] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const updateBusy = pending || state?.status === "checking" || state?.status === "downloading";

	const check = async () => {
		if (!updates || pending) return;
		setPending(true);
		try {
			const result = await updates.check();
			if (!result.accepted && result.state.status !== "downloaded") {
				toast.info("An update check is already in progress.");
			}
		} catch (error) {
			toast.error("Could not check for updates", {
				description: error instanceof Error ? error.message : "An unexpected error occurred.",
			});
		} finally {
			setPending(false);
		}
	};

	const setTrack = async (track: "stable" | "preview" | null) => {
		if (!updates || pending || !track || track === state?.track) return;
		setPending(true);
		try {
			const result = await updates.setTrack(track);
			if (!result.accepted) {
				toast.error("Could not change update track", {
					description: result.state.message ?? "The update track could not be changed.",
				});
			}
		} catch (error) {
			toast.error("Could not change update track", {
				description: error instanceof Error ? error.message : "An unexpected error occurred.",
			});
		} finally {
			setPending(false);
		}
	};

	const install = async () => {
		if (!updates || !state) return;
		try {
			const result = await updates.install();
			if (!result.accepted || result.state.message) {
				toast.error("Could not install update", {
					description: result.state.message ?? undefined,
				});
			}
		} catch (error) {
			toast.error("Could not install update", {
				description: error instanceof Error ? error.message : "An unexpected error occurred.",
			});
		}
	};

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="about-settings">
			<SettingsPageHeader />
			<section
				className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border"
				data-qa-id="about-version"
			>
				<div>
					<SummaryCard.Row>
						<SummaryCard.Content>
							<SummaryCard.Title>
								Version
								{state ? (
									<code className="text-muted-foreground text-2xs font-medium">
										{state.currentVersion}
									</code>
								) : (
									<SkeletonText className="text-2xs w-12" />
								)}
							</SummaryCard.Title>
							{state ? (
								<SummaryCard.Description data-qa-id="update-status-message">
									{getUpdateDescription(state)}
								</SummaryCard.Description>
							) : (
								<SummaryCard.Description
									role="status"
									aria-busy="true"
									aria-label="Loading update information"
									data-qa-id="update-status-message"
								>
									<SkeletonText className="w-56" />
								</SummaryCard.Description>
							)}
						</SummaryCard.Content>
						<SummaryCard.Actions>
							{state?.status === "downloaded" ? (
								<Button size="sm" data-qa-id="update-install" onClick={() => setConfirmOpen(true)}>
									Restart to update
								</Button>
							) : (
								<Button
									size="sm"
									variant="outline"
									disabled={!state?.enabled || updateBusy}
									data-qa-id="update-check"
									onClick={() => void check()}
								>
									{pending || state?.status === "checking" || state?.status === "downloading" ? (
										<Spinner data-icon="inline-start" aria-hidden="true" />
									) : null}
									{getUpdateButtonLabel(state, pending)}
								</Button>
							)}
						</SummaryCard.Actions>
					</SummaryCard.Row>
				</div>
				<div>
					<SummaryCard.Row>
						<SummaryCard.Content>
							<SummaryCard.Title>
								<label htmlFor="update-track">Update track</label>
							</SummaryCard.Title>
							<SummaryCard.Description>
								Use stable releases or preview builds.
							</SummaryCard.Description>
						</SummaryCard.Content>
						<SummaryCard.Actions>
							<Select
								value={state?.track ?? "preview"}
								items={[
									{ value: "stable", label: "Stable" },
									{ value: "preview", label: "Preview" },
								]}
								onValueChange={(track) => void setTrack(track)}
							>
								<SelectTrigger
									id="update-track"
									size="sm"
									aria-label="Update track"
									className="w-36"
									disabled={!state?.enabled || updateBusy || state?.status === "downloaded"}
									data-qa-id="update-track"
								>
									{state ? <SelectValue /> : <SkeletonText className="w-14" />}
								</SelectTrigger>
								<SelectContent align="end" alignItemWithTrigger={false}>
									<SelectGroup>
										<SelectItem value="stable" data-qa-id="update-track-stable">
											Stable
										</SelectItem>
										<SelectItem value="preview" data-qa-id="update-track-preview">
											Preview
										</SelectItem>
									</SelectGroup>
								</SelectContent>
							</Select>
						</SummaryCard.Actions>
					</SummaryCard.Row>
				</div>

				{state?.releaseNotes.some(hasVisibleReleaseNotes) ? (
					<FieldSet
						className="border-border bg-background/60 border-t p-4"
						data-qa-id="update-release-notes"
					>
						<FieldLegend className="flex items-baseline gap-2">
							What's changed
							<code className="text-muted-foreground text-2xs font-medium">
								{targetRelease?.version}
							</code>
						</FieldLegend>
						<ReleaseNotesList notes={state.releaseNotes} showHeading={false} />
					</FieldSet>
				) : null}
			</section>
			{state ? (
				<InstallUpdateDialog
					open={confirmOpen}
					onOpenChange={setConfirmOpen}
					state={state}
					onConfirm={() => {
						setConfirmOpen(false);
						void install();
					}}
				/>
			) : null}
		</div>
	);
}

function getUpdateDescription(state: DesktopUpdateState): string {
	const targetVersion = state.downloadedVersion ?? state.availableVersion;
	switch (state.status) {
		case "disabled":
		case "error":
			return state.message ?? "Automatic updates are unavailable.";
		case "checking":
			return "Checking for a newer version…";
		case "downloading":
			return targetVersion ? `Downloading version ${targetVersion}…` : "Downloading update…";
		case "downloaded":
			return targetVersion
				? `Version ${targetVersion} is ready to install.`
				: "An update is ready to install.";
		case "up-to-date":
			return "You're up to date.";
		case "idle":
			return "Current version of the application.";
	}
}

function getUpdateButtonLabel(
	state: DesktopUpdateState | null | undefined,
	pending: boolean,
): string {
	if (pending || state?.status === "checking") return "Checking…";
	if (state?.status === "downloading") return "Downloading…";
	return "Check for updates";
}
