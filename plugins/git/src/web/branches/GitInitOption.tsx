import { useQuery } from "@tanstack/react-query";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import type { NewWorkSessionOptionProps } from "@kilo-desktop/plugin-work-sessions/contracts";

import { Repository } from "../../contracts";
import { repositoryTypeQuery } from "../shared/repository-queries";
import { InitializeGitButton } from "./InitializeGitButton";

/** The New Session page's `setup` option: Initialize Git for a folder that is not a repository. */
export function GitInitOption({ directory, disabled, onChanged }: NewWorkSessionOptionProps) {
	const repository = useDomainObject(Repository);
	const type = useQuery(repositoryTypeQuery(repository, directory));
	if (type.data?.kind !== "missing") return null;
	return (
		<InitializeGitButton
			directory={directory}
			qaId="git-init-new-session-button"
			disabled={disabled}
			onInitialized={onChanged}
		/>
	);
}
