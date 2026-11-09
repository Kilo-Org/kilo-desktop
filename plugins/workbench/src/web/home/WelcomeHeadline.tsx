import { useState, type AnimationEvent } from "react";

import { KiloWelcomeLogo } from "@kilo-desktop/ui/components/brand/kilo-welcome-logo";
import {
	useWorkspacePickerSource,
	WorkspacePickerRoot,
	WorkspacePickerTrigger,
} from "@kilo-desktop/ui/components/workspace-picker";

/** "What should we work on in ‹workspace›?", the workspace changeable in place. */
export function WelcomeHeadline() {
	const { workspaces, activeWorkspaceId } = useWorkspacePickerSource();
	const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
	const [lottieEnabled, setLottieEnabled] = useState(false);

	const handleAnimationEnd = (event: AnimationEvent<HTMLHeadingElement>) => {
		if (event.target === event.currentTarget) setLottieEnabled(true);
	};

	return (
		<div className="relative z-10 mb-6 flex w-full max-w-3xl flex-col items-center px-4 text-center">
			<KiloWelcomeLogo lottieEnabled={lottieEnabled} />
			<h1
				data-qa-id="launcher-headline"
				className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex w-full max-w-full flex-wrap items-baseline justify-center text-2xl font-medium duration-200"
				onAnimationEnd={handleAnimationEnd}
			>
				{active ? (
					<>
						<span className="shrink-0">What should we work on in{"\u00a0"}</span>
						<WorkspacePickerRoot contentAlign="center">
							<WorkspacePickerTrigger
								aria-label="Change workspace"
								render={
									<button
										type="button"
										data-qa-id="launcher-workspace"
										className="border-foreground/60 text-foreground hover:border-foreground/80 focus-visible:ring-ring pointer-events-auto inline-flex max-w-full min-w-0 cursor-pointer border-b border-dotted wrap-anywhere transition-colors focus-visible:rounded-sm focus-visible:ring-2 focus-visible:outline-hidden"
									/>
								}
							>
								<span className="min-w-0 wrap-anywhere">{active.name}</span>
							</WorkspacePickerTrigger>
						</WorkspacePickerRoot>
						<span className="shrink-0">?</span>
					</>
				) : (
					<span className="shrink-0">What should we work on?</span>
				)}
			</h1>
		</div>
	);
}
