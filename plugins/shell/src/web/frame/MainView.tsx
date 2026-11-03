import { LayoutPanelLeftIcon } from "lucide-react";

import { RenderContribution, useExclusive } from "@kilo-desktop/kernel/web";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

import { Main, type MainImplementation } from "../../contracts";

const selectComponent = (implementation: MainImplementation) => implementation.component;

/** The main-area view at "/": the winning kilo.shell/main contribution. */
export function MainView() {
	const home = useExclusive(Main).winner;
	if (!home) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<Empty data-qa-id="shell-home-empty">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<LayoutPanelLeftIcon />
						</EmptyMedia>
						<EmptyTitle>Nothing to show here</EmptyTitle>
						<EmptyDescription>
							The shell is running, but no enabled plugin contributes a main view.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</div>
		);
	}
	return <RenderContribution contribution={home} select={selectComponent} />;
}
