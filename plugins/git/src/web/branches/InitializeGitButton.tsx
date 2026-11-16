import { FolderGit2Icon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { useInitRepository } from "../shared/repository-queries";

/** `git init` in `directory`; failures toast, `onInitialized` runs once the cached reads are fresh. */
export function InitializeGitButton({
	directory,
	qaId,
	className,
	disabled,
	onInitialized,
}: {
	readonly directory: string;
	readonly qaId: string;
	readonly className?: string;
	readonly disabled?: boolean;
	readonly onInitialized?: () => void;
}) {
	const { isPending, init } = useInitRepository();
	return (
		<Button
			className={cn("[&_svg]:text-foreground/40", className)}
			data-qa-id={qaId}
			disabled={disabled || isPending}
			onClick={() => init(directory, onInitialized)}
			size="sm"
			type="button"
			variant="ghost"
		>
			{isPending ? (
				<Spinner data-icon="inline-start" aria-hidden="true" />
			) : (
				<FolderGit2Icon data-icon="inline-start" />
			)}
			Initialize Git
		</Button>
	);
}
