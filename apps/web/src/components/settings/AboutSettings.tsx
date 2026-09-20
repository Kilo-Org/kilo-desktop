import { useState } from "react";

import type { DesktopUpdateState } from "@kilo-desktop/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
} from "@kilo-desktop/ui/components/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { hasVisibleReleaseNotes, ReleaseNotesList } from "@/components/updates/ReleaseNotesList";
import { getInstallConfirmationMessage } from "@/components/updates/updateActions";
import { useDesktopUpdates } from "@/platform/updates/UpdateProvider";

export function AboutSettings() {
	const updates = useDesktopUpdates();
	const state = updates?.state;
	const targetRelease = state?.releaseNotes.find(hasVisibleReleaseNotes);
	const [pending, setPending] = useState(false);
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
		if (!globalThis.confirm(getInstallConfirmationMessage(state, navigator.platform))) return;
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
		<div className="mx-auto w-full max-w-3xl" data-qa-id="about-settings">
			<h1 className="text-base font-semibold tracking-tight" data-qa-id="settings-section-heading">
				About
			</h1>

			<section
				className="border-border bg-card mt-5 min-w-0 overflow-hidden rounded-xl border"
				data-qa-id="about-version"
			>
				<div className="flex flex-col gap-4 p-4 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-8">
					<div className="min-w-0 space-y-0.5">
						<div className="flex items-baseline gap-2">
							<h2 className="text-sm leading-tight font-medium">Version</h2>
							<code className="text-muted-foreground text-[11px] font-medium">
								{state?.currentVersion ?? "Loading…"}
							</code>
						</div>
						<p
							className="text-muted-foreground max-w-xl text-xs"
							data-qa-id="update-status-message"
						>
							{getUpdateDescription(state)}
						</p>
					</div>

					<div className="flex shrink-0 items-center sm:justify-end">
						{state?.status === "downloaded" ? (
							<Button size="sm" data-qa-id="update-install" onClick={() => void install()}>
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
								{getUpdateButtonLabel(state, pending)}
							</Button>
						)}
					</div>
				</div>

				<div className="border-border border-t p-4">
					<Field orientation="horizontal" className="justify-between gap-6">
						<FieldContent>
							<FieldLabel className="text-sm" htmlFor="update-track">
								Update track
							</FieldLabel>
							<FieldDescription className="text-xs">
								Use stable releases or preview builds.
							</FieldDescription>
						</FieldContent>
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
								className="ml-auto w-40 shrink-0 self-center"
								disabled={!state?.enabled || updateBusy || state?.status === "downloaded"}
								data-qa-id="update-track"
							>
								<SelectValue />
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
					</Field>
				</div>

				{state?.releaseNotes.some(hasVisibleReleaseNotes) ? (
					<div
						className="border-border bg-background/60 border-t p-4"
						data-qa-id="update-release-notes"
					>
						<div className="flex items-baseline gap-2">
							<h2 className="text-sm font-medium">What's changed</h2>
							<code className="text-muted-foreground text-[11px] font-medium">
								{targetRelease?.version}
							</code>
						</div>
						<div className="mt-3">
							<ReleaseNotesList notes={state.releaseNotes} showHeading={false} />
						</div>
					</div>
				) : null}
			</section>
		</div>
	);
}

function getUpdateDescription(state: DesktopUpdateState | null | undefined): string {
	if (!state) return "Loading update information…";
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
	return "Check for Updates";
}
