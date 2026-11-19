import { LinkIcon } from "lucide-react";
import { useId, useState } from "react";

import { useDomainObject } from "@kilo-desktop/kernel/web";
import type {
	WorkspaceSourceImplementation,
	WorkspaceSourceProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { Field, FieldDescription, FieldError, FieldLabel } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { Clone } from "../../contracts";
import { gitUnavailable } from "./clone-errors";
import { FILLED_INPUT_CLASS } from "@kilo-desktop/ui/lib/filled-styles";
import { isGitUrl, repositoryNameFromGitUrl } from "./git-url";

/** Clones any Git remote: the URL first, then the usual name, colour and location. */
function GitUrlSource({ NewFolderForm, appearance }: WorkspaceSourceProps) {
	const clone = useDomainObject(Clone);
	const urlId = useId();
	const [url, setUrl] = useState("");
	const [touched, setTouched] = useState(false);
	const valid = isGitUrl(url);
	const showInvalid = touched && url.trim() !== "" && !valid;

	return (
		<NewFolderForm
			description="Clone any Git repository with your own credentials."
			leadingField={
				<Field>
					<FieldLabel htmlFor={urlId}>Repository URL</FieldLabel>
					<Input
						id={urlId}
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						onBlur={() => setTouched(true)}
						placeholder="https://gitlab.com/owner/repo.git"
						aria-invalid={showInvalid ? true : undefined}
						autoFocus
						className={cn(appearance === "filled" && FILLED_INPUT_CLASS)}
						spellCheck={false}
						data-qa-id="workspace-git-url"
					/>
					{showInvalid ? (
						<FieldError>Enter an HTTPS or SSH URL, e.g. git@gitlab.com:owner/repo.git.</FieldError>
					) : (
						<FieldDescription>HTTPS or SSH. Cloned with your own Git credentials.</FieldDescription>
					)}
				</Field>
			}
			suggestedName={repositoryNameFromGitUrl(url)}
			ready={valid}
			pendingLabel="Cloning…"
			errorTitle="Couldn't clone the repository"
			create={async (details) =>
				(clone ?? gitUnavailable()).methods.cloneWorkspace({
					...details,
					source: { kind: "url", url: url.trim() },
				})
			}
		/>
	);
}

export const gitUrlSource: WorkspaceSourceImplementation = {
	icon: LinkIcon,
	Component: GitUrlSource,
};
