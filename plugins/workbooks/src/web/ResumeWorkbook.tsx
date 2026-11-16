import { useEffect, useState } from "react";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import { Button } from "@kilo-desktop/ui/components/button";

import type { Workbook, WorkbookProgress, Workbooks } from "../contracts";

/** What starting from the resume view should focus the new chat on. */
export type ResumeChoice = { readonly focus?: string };

/**
 * Where a workbook is at, read from Pages when it is picked: the last "Where I
 * left off", plan progress and open items, with suggested next steps that each
 * start a session on that focus. While Pages is being read (or can't be), the
 * person can still just start a session on the workbook.
 */
export function ResumeWorkbook({
	workbook,
	workbooks,
	busy,
	onBack,
	onStart,
}: {
	readonly workbook: Workbook;
	readonly workbooks: DomainObjectHandle<typeof Workbooks> | null;
	readonly busy: boolean;
	/** Back to the list; absent when there is nothing to go back to. */
	readonly onBack?: () => void;
	readonly onStart: (choice: ResumeChoice) => void;
}) {
	const [progress, setProgress] = useState<WorkbookProgress | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let current = true;
		workbooks?.methods.progress({ workbookId: workbook.id }).then(
			(next) => current && setProgress(next),
			() => current && setFailed(true),
		);
		return () => {
			current = false;
		};
	}, [workbooks, workbook.id]);

	const done = progress?.steps.filter((step) => step.status === "done").length ?? 0;
	return (
		<div className="flex flex-col gap-3 py-2" data-qa-id="workbooks-resume">
			<div className="flex items-center justify-between gap-2">
				<h3 className="truncate text-sm font-medium">{workbook.name}</h3>
				{onBack ? (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						data-qa-id="workbooks-resume-back"
						onClick={onBack}
					>
						Back
					</Button>
				) : null}
			</div>
			{progress ? (
				<>
					{progress.steps.length > 0 ? (
						<p className="text-sm" data-qa-id="workbooks-resume-progress">
							{done} of {progress.steps.length} plan steps done
						</p>
					) : null}
					{progress.whereILeftOff.length > 0 ? (
						<div className="flex flex-col gap-1" data-qa-id="workbooks-resume-left-off">
							<p className="text-muted-foreground text-xs font-medium">Where I left off</p>
							<ul className="text-sm">
								{progress.whereILeftOff.map((line) => (
									<li key={line}>{line}</li>
								))}
							</ul>
						</div>
					) : null}
					<OpenItems progress={progress} />
				</>
			) : (
				<p className="text-muted-foreground text-sm" data-qa-id="workbooks-resume-loading">
					{failed
						? "Couldn't read where this workbook is at."
						: "Reading where this workbook is at…"}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				{progress?.next ? (
					<Button
						type="button"
						size="sm"
						disabled={busy}
						data-qa-id="workbooks-resume-next"
						onClick={() =>
							onStart({ focus: `Plan step ${progress.next!.number}: ${progress.next!.title}` })
						}
					>
						Continue step {progress.next.number}: {progress.next.title}
					</Button>
				) : null}
				{progress && progress.openQuestions > 0 ? (
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={busy}
						data-qa-id="workbooks-resume-questions"
						onClick={() => onStart({ focus: "Help me answer the workbook's open questions." })}
					>
						Answer open questions
					</Button>
				) : null}
				<Button
					type="button"
					size="sm"
					variant={progress?.next ? "ghost" : "default"}
					disabled={busy}
					data-qa-id="workbooks-resume-start"
					onClick={() => onStart({})}
				>
					Start session
				</Button>
			</div>
		</div>
	);
}

function OpenItems({ progress }: { readonly progress: WorkbookProgress }) {
	const items = [
		[progress.openQuestions, "open question"],
		[progress.openTasks, "open task"],
		[progress.openReview, "review comment"],
	] as const;
	const shown = items.filter(([count]) => count > 0);
	if (shown.length === 0) return null;
	return (
		<p className="text-muted-foreground text-xs" data-qa-id="workbooks-resume-open">
			{shown.map(([count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`).join(" · ")}
		</p>
	);
}
