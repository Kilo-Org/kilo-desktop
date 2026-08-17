import { WorkspaceFormFields } from "../workspaces/WorkspaceFormFields.js";
import type { useWorkspaceForm } from "../workspaces/useWorkspaceForm.js";

export function WorkspaceStep({ form }: { form: ReturnType<typeof useWorkspaceForm> }) {
	return (
		<div data-qa-id="onboarding-workspace-step">
			<WorkspaceFormFields {...form} nameId="onboarding-workspace-name" />
		</div>
	);
}
