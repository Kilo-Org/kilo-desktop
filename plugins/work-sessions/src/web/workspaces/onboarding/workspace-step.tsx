import { useState } from "react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import type { OnboardingStepImplementation } from "@kilo-desktop/plugin-shell/contracts";

import { Workspaces } from "../../../contracts";
import { useFolderPicking, useWorkspaceForm } from "../useWorkspaceForm";
import { WorkspacePreview, WorkspaceStep } from "./WorkspaceStep";

/**
 * Creates the first workspace and makes it active. Offered only when there are
 * none yet (`showWhen`), and skippable.
 */
export const workspaceStep: OnboardingStepImplementation = {
	useStep: ({ next }) => {
		const workspaces = useDomainObject(Workspaces);
		const form = useWorkspaceForm({ shell: useFolderPicking() });
		const [busy, setBusy] = useState(false);

		const create = async () => {
			if (!workspaces || !form.validate()) return;
			setBusy(true);
			try {
				const saved = await workspaces.methods.create({
					name: form.name,
					color: form.color,
					folders: form.folders,
					source: "onboarding",
				});
				await workspaces.methods.setActive({ id: saved.id });
				next();
			} catch (reason) {
				form.setError(
					reason instanceof Error && reason.message ? reason.message : "Could not save workspace.",
				);
			} finally {
				setBusy(false);
			}
		};

		return {
			title: "Create a workspace",
			subtitle:
				"Point Kilo at the folders you want the agent to work in. You can add more workspaces anytime.",
			body: <WorkspaceStep form={form} />,
			aside: <WorkspacePreview form={form} />,
			primary: {
				label: busy ? "Creating…" : "Create workspace",
				disabled: busy || form.folders.length === 0,
				onClick: () => void create(),
			},
			skippable: true,
			busy,
		};
	},
};
