import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import type {
	OnboardingStepImplementation,
	OnboardingStepProps,
} from "@kilo-desktop/plugin-shell/contracts";

import type { WorkspaceDraft } from "../new-folder-context";
import {
	ScreenEntrance,
	ScreensViewport,
	SourceIcon,
	SourceScreens,
	useActivateCreated,
	useFolderLocationServices,
	useScreenState,
	useWorkspaceSources,
	type SourceContribution,
} from "../workspace-source-host";
import { WorkspacePreview } from "./WorkspaceStep";

/**
 * Creates the first workspace and makes it active. The card's left side first
 * offers every workspace source (local folders, a clone…), then shows the
 * chosen one's screens in its place, with onboarding's filled fields and its
 * footer's primary button; the aside previews the workspace as it is filled
 * in. The card stays mounted throughout: screens enter with a fade and the
 * body eases to each one's height. Offered only when there are none yet
 * (`showWhen`), and skippable.
 */
export const workspaceStep: OnboardingStepImplementation = { Step: WorkspaceOnboardingStep };

function WorkspaceOnboardingStep({ next, children }: OnboardingStepProps) {
	const sources = useWorkspaceSources();
	const [chosenKey, setChosenKey] = useState<string | null>(null);
	const chosen = sources.find((source) => source.key === chosenKey) ?? null;
	const [draft, setDraft] = useState<WorkspaceDraft | null>(null);
	const locations = useFolderLocationServices();
	const onCreated = useActivateCreated(() => next());
	const { screen, primary, report, reset } = useScreenState();
	const changeSource = () => {
		reset();
		setDraft(null);
		setChosenKey(null);
	};

	return children({
		title: "Create a workspace",
		subtitle:
			"Point Kilo at the folders you want the agent to work in. You can add more workspaces anytime.",
		body: (
			<ScreensViewport>
				{chosen ? (
					<SourceScreens
						source={chosen}
						services={{
							...locations,
							onCreated,
							appearance: "filled",
							origin: "onboarding",
							onDraft: setDraft,
						}}
						report={report}
						onChangeSource={changeSource}
					/>
				) : (
					<ScreenEntrance>
						<SourceOptions sources={sources} onSelect={setChosenKey} />
					</ScreenEntrance>
				)}
			</ScreensViewport>
		),
		aside: <WorkspacePreview draft={draft} />,
		primary: chosen ? primary : null,
		skippable: true,
		busy: chosen !== null && screen?.busy === true,
	});
}

function SourceOptions({
	sources,
	onSelect,
}: {
	sources: readonly SourceContribution[];
	onSelect(key: string): void;
}) {
	return (
		<div data-qa-id="onboarding-workspace-step" className="flex flex-col gap-3">
			{sources.map((source) => (
				<button
					key={source.key}
					type="button"
					data-qa-id={`onboarding-workspace-source-${source.key}`}
					onClick={() => onSelect(source.key)}
					className="bg-foreground/5 hover:bg-foreground/8 focus-visible:ring-primary-ink flex items-center gap-3 rounded-2xl p-4 text-left ring-1 ring-transparent transition-[background-color,box-shadow] outline-none"
				>
					<span className="bg-background grid size-8 shrink-0 place-items-center rounded-xl">
						<SourceIcon source={source} className="size-4" />
					</span>
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="text-sm font-medium">{source.metadata.title}</span>
						<span className="text-muted-foreground text-sm">{source.metadata.description}</span>
					</span>
					<ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
				</button>
			))}
		</div>
	);
}
