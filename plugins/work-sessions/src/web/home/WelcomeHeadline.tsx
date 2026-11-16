import { useState, type AnimationEvent } from "react";

import { KiloWelcomeLogo } from "@kilo-desktop/ui/components/brand/kilo-welcome-logo";
import { useWorkspacePickerSource } from "@kilo-desktop/ui/components/workspace-picker";

/** "What should we work on in ‹workspace›?"; the workspace is changed in the location row under it. */
export function WelcomeHeadline() {
	const { workspaces, activeWorkspaceId } = useWorkspacePickerSource();
	const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
	const [lottieEnabled, setLottieEnabled] = useState(false);

	const handleAnimationEnd = (event: AnimationEvent<HTMLHeadingElement>) => {
		if (event.target === event.currentTarget) setLottieEnabled(true);
	};

	return (
		<div className="relative z-10 mb-6 flex w-full flex-col items-center text-center">
			<KiloWelcomeLogo lottieEnabled={lottieEnabled} />
			<h1
				data-qa-id="launcher-headline"
				className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both w-full max-w-full text-2xl font-medium wrap-anywhere duration-200"
				onAnimationEnd={handleAnimationEnd}
			>
				{active ? (
					<>
						What should we work on in <span>{active.name}</span>?
					</>
				) : (
					"What should we work on?"
				)}
			</h1>
		</div>
	);
}
