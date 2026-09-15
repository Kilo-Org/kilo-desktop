import { useState, type FormEvent } from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anaconda-agentic-desktop/ui/components/dialog";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@anaconda-agentic-desktop/ui/components/field";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anaconda-agentic-desktop/ui/components/select";

type BaseSelection = "default" | "current";

/**
 * Create-branch dialog opened by the pinned popover item (the workspace
 * picker's `openCreate` pattern): the popover closes and hands its
 * captured search text over as the starting name. The parent mounts this
 * only while open, so `useState` initializers seed both fields on every
 * open and no reset effect is needed.
 *
 * Desktop-aligned based-on choice, limited to its two meaningful options:
 * when the detected default branch (from the `branches` result, the
 * service's `findDefaultBranch` resolution — a remote-only hit arrives
 * as e.g. `origin/main`, and that full name works as a `startPoint` for
 * both kinds) exists and differs from the current one, a "Create branch
 * based on…" select offers the default (pre-selected) or the current
 * branch; otherwise the informational copy states the new branch is
 * based on the current one. When no branch is checked out at all
 * (detached/unborn), no based-on UI renders and creation goes off HEAD.
 *
 * A failed create surfaces as an inline invalid-input error: the parent
 * owns the error string (`errorMessage`, cleared on retry/cancel/reopen)
 * and the dialog reports name edits back via `onClearError` so a stale
 * error disappears as soon as the user starts correcting the name.
 */
export function CreateBranchDialog({
	initialName,
	isPending,
	errorMessage,
	defaultBranch,
	currentBranch,
	onClearError,
	onCancel,
	onCreate,
}: {
	readonly initialName: string;
	readonly isPending: boolean;
	readonly errorMessage: string | undefined;
	readonly defaultBranch: string | undefined;
	readonly currentBranch: string | undefined;
	readonly onClearError: () => void;
	readonly onCancel: () => void;
	readonly onCreate: (name: string, startPoint?: string) => void;
}) {
	const [name, setName] = useState(initialName);
	const trimmedName = name.trim();
	const offerBaseChoice =
		defaultBranch !== undefined && currentBranch !== undefined && defaultBranch !== currentBranch;
	const [base, setBase] = useState<BaseSelection>("default");

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (trimmedName === "" || isPending) return;
		// Desktop's `startPoint: null` = current HEAD → omitted from the call.
		onCreate(trimmedName, offerBaseChoice && base === "default" ? defaultBranch : undefined);
	};

	return (
		<Dialog open onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
			<DialogContent
				data-qa-id="git-branch-create-dialog"
				className="sm:max-w-sm"
				showCloseButton={false}
			>
				<form onSubmit={submit} className="contents">
					<DialogHeader>
						<DialogTitle>Create branch</DialogTitle>
					</DialogHeader>
					<FieldGroup>
						<Field data-invalid={Boolean(errorMessage) || undefined}>
							<FieldLabel htmlFor="git-branch-create-name">Name</FieldLabel>
							<Input
								id="git-branch-create-name"
								data-qa-id="git-branch-create-name"
								autoFocus
								placeholder="Branch name"
								aria-invalid={Boolean(errorMessage) || undefined}
								value={name}
								onChange={(event) => {
									setName(event.target.value);
									onClearError();
								}}
							/>
							{errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
						</Field>
						{currentBranch === undefined ? null : offerBaseChoice ? (
							<Field>
								<FieldLabel htmlFor="git-branch-create-base">Create branch based on…</FieldLabel>
								<Select
									value={base}
									onValueChange={(value) => {
										setBase(value === "current" ? "current" : "default");
									}}
								>
									<SelectTrigger
										id="git-branch-create-base"
										data-qa-id="git-branch-create-base"
										className="w-full"
									>
										<SelectValue>
											{(value) => (value === "current" ? currentBranch : defaultBranch)}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectItem data-qa-id="git-branch-create-base-default" value="default">
											{defaultBranch}
										</SelectItem>
										<SelectItem data-qa-id="git-branch-create-base-current" value="current">
											{currentBranch}
										</SelectItem>
									</SelectContent>
								</Select>
							</Field>
						) : (
							<p className="text-muted-foreground text-sm">
								Your new branch will be based on your currently checked out branch ({currentBranch}
								).
							</p>
						)}
					</FieldGroup>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onCancel}>
							Cancel
						</Button>
						<Button
							type="submit"
							data-qa-id="git-branch-create-submit"
							disabled={trimmedName === "" || isPending}
						>
							Create branch
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
