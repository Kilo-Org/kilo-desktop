This is the agent guide for this workbook. It carries the user's authority: treat it like instructions the user typed, below the repository's own rules (AGENTS.md) and above general habits. The user may edit it at any time; re-read it at the start of every chat.

The workbook is the Brief (the Project document), this page, the **Plan**, **Follow-ups**, **Decisions & findings** and the **Change Log**. Each section says under its heading what belongs there.

## Start of a chat

1. Read the Brief: the **Goal**, **Where we left off** and **Open questions**.
2. Read this page.
3. Read the Plan. Read Decisions & findings when a choice or fact matters to what you're doing.
4. If you were started on a specific plan step or item, work on that only.

## First move in a new workbook

Refine the Brief: ask about anything missing, and propose acceptance criteria and constraints for the user to confirm. Then draft the Plan as small steps, each sized for one chat and ending in one commit, with the tasks each needs under it. Stop and ask the user to confirm the Plan before building anything.

## Extract, don't archive

File information the moment it appears, in the section whose description fits. Never leave something worth keeping only in the chat, and never write notes about the chat instead of the thing itself.

Use the workbook tools (`desktop_workbooks_*`): they know which workbook this chat is on, write each section's format, and check its rules. `read_workbook` lists the sections and what each collects.

- Record a decision only once the user has made or confirmed it. A reversal is a new decision that supersedes the old one (`add_item` with `supersedes`).
- A finding that turns out wrong is superseded, never deleted.
- When the user answers an open question, use `answer_question` and record the decision in Decisions.
- Work that belongs to no step is either a new step (in scope, worth a commit) or a follow-up. A task is part of its step and has no commit of its own.
- Re-cutting the Plan (renaming, reordering, splitting, dropping steps) uses `edit_step`, `move_step`, `add_item` and `remove_item`; steps are renumbered for you.
- The Goal changes only when the user asks.

## Working on a plan step

1. Mark it in progress before starting, so other agents can see it is taken.
2. Keep changes to that step. Tick its tasks as you go, and add any it turns out to need; anything outside it goes to Follow-ups.
3. When its tasks are ticked (or moved to Follow-ups), verify it (tests, lint, type checks as the repository requires), then **commit it as its own commit**, one commit per plan step, with the step in the message.
4. Then mark it done with the result and the commit link (or why there is no commit), and record any decisions or findings made along the way.

A review comment on a finished step reopens it with a new task, or becomes a new step.

## Etiquette with other writers

People and other agents may be editing at the same time.

- Edit in place or append; never restructure or delete what you did not write without asking.
- Keep edits small and targeted.

## Before your context runs out, or when you stop

Hand off with `hand_off`: what was done, what is next, any `(you)` tasks waiting on the user, and anything a fresh chat must know. It replaces **Where we left off** and adds the entry to the **Change Log**. Then tell the user the workbook is current and it is safe to start a new chat.
