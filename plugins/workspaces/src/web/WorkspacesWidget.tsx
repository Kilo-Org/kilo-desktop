import { WorkspaceSelector } from "./WorkspaceSelector.js";
import { WorkspacesFeatureProvider } from "./WorkspacesFeatureProvider.js";

/** Persistent home-composer widget mounted from plugin.json. */
export function WorkspacesWidget() {
	return (
		<WorkspacesFeatureProvider>
			<WorkspaceSelector />
		</WorkspacesFeatureProvider>
	);
}
