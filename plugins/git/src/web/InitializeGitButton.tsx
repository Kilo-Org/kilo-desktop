import { FolderGit2Icon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { useInitRepository } from "./use-init-repository.js";

type ButtonProps = React.ComponentProps<typeof Button>;

export interface InitializeGitButtonProps {
	/** Working directory the `init` mutation targets. */
	readonly workspaceDirectory: string;
	/** Built-in button size: `sm` for the draft footer, `xs` for the thread footer. */
	readonly size?: ButtonProps["size"];
	/** Stable `data-qa-id` distinguishing the footer the button renders in. */
	readonly testId: string;
	/**
	 * Footer-specific chrome. The thread footer passes the usage rail's muted
	 * look (`text-foreground/70` text, `text-foreground/40` icons) so the
	 * button sits beside the metrics like the branch label does.
	 */
	readonly className?: string | undefined;
}

/**
 * Presentational "Initialize Git" action shared by the composer footer
 * contributions (`GitBranchSelector` for drafts, `GitBranchLabel` for
 * existing threads). No repository-type gating lives here — the parents
 * own the `repositoryType` probe and render this only once it resolves
 * `missing`. A successful init invalidates the query through
 * `useInitRepository`, the refetch reports `regular`, and the parent
 * swaps back to the branch UI. Failures toast and leave the button in
 * place. Text label, so no tooltip.
 */
export function InitializeGitButton({
	workspaceDirectory,
	size,
	testId,
	className,
}: InitializeGitButtonProps) {
	const initRepository = useInitRepository();

	return (
		<Button
			className={className}
			data-qa-id={testId}
			disabled={initRepository.isPending}
			onClick={() => initRepository.init(workspaceDirectory)}
			size={size}
			type="button"
			variant="ghost"
		>
			{initRepository.isPending ? (
				<Spinner data-icon="inline-start" size="sm" />
			) : (
				<FolderGit2Icon data-icon="inline-start" />
			)}
			Initialize Git
		</Button>
	);
}
