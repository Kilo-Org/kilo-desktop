This is the agent guide for this workbook. It carries the user's authority: treat it like instructions the user typed, below the repository's own rules (AGENTS.md) and above general habits. The user may edit it at any time; re-read it at the start of every chat.

The workbook is the Brief (the Project document), this page, the **Plan** (steps, each with its tasks, then follow-ups) and **Decisions & findings**.

## Start of a chat

1. Read the Brief, especially **Where I left off** and **Open questions**.
2. Read this page.
3. Read the Plan. Read Decisions & findings when a choice or fact matters to what you're doing.
4. If you were started on a specific plan step or item, work on that only.

## First move in a new workbook

Refine the Brief: ask about anything missing, and propose acceptance criteria and constraints for the user to confirm. Then draft the Plan as small steps, each sized for one chat and ending in one commit, with the tasks each needs under it. Stop and ask the user to confirm the Plan before building anything.

## Extract, don't archive

File information the moment it appears, where it belongs. Never leave something worth keeping only in the chat.

When the workbook tools are available (`desktop_workbooks_read_workbook`, `add_plan_step`, `set_step_status`, `record_decision`, `file_item`, `set_where_i_left_off`), use them: they write the formats below for you and know which workbook this chat is on. Otherwise use these formats exactly: the app reads them.

| Where                            | Holds                                                   | Format                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan → Steps (`plan`)            | The work, in order: each step ends in one commit        | `- [ ] **N. Title**: one line of intent` · while working add ` · in progress` or ` · blocked: reason` · when done tick it and add ` · done: outcome (commit/PR link)` |
| Plan → a step's tasks            | What the step needs: chores, review comments, user jobs | Indented under the step: `  - [ ] Task` · a review comment is `  - [ ] **file or area**: issue and suggested fix` · a job only the user can do ends `(you)`           |
| Plan → Follow-ups (`follow-ups`) | Out-of-scope work noticed along the way                 | `- [ ] Follow-up (context)` · never do it inside the current change                                                                                                   |
| Decisions & findings → Decisions | Choices the user confirmed                              | `- **Decision.** Why: reason. Rejected: alternatives. (YYYY-MM-DD)` · never record your own suggestion until the user confirms it · a reversal is a new decision      |
| Decisions & findings → Findings  | Facts learned, with evidence                            | `- **Finding.** Evidence: how we know. (YYYY-MM-DD)` · mark wrong ones `~~struck~~ superseded by …` rather than deleting                                              |
| Brief → Open questions           | Things the user must decide                             | `- **Question?** Context.` · when answered, record a Decision and delete the question                                                                                 |
| Brief → Context and links        | The issue, the branch, the PR                           | Add the branch and PR here once they exist                                                                                                                            |

A task is part of its step and has no commit of its own. Work that belongs to no step is either a new step (in scope, worth a commit) or a follow-up.

## Working on a plan step

1. Mark it ` · in progress` before starting, so other agents can see it is taken.
2. Keep changes to that step. Tick its tasks as you go, and add any it turns out to need; anything outside it goes to Follow-ups.
3. When its tasks are ticked (or moved to Follow-ups), verify it (tests, lint, type checks as the repository requires), then **commit it as its own commit**, one commit per plan step, with the step in the message.
4. Then tick it with the outcome and the commit link, and record any Decisions or Findings made along the way.

A review comment on a finished step reopens it with a new task, or becomes a new step.

## Etiquette with other writers

People and other agents may be editing at the same time.

- Edit in place or append; never restructure or delete what you did not write without asking.
- Keep edits small and targeted.
- If an edit conflicts with a newer revision, re-read and reapply rather than overwriting.

## Before your context runs out, or when you stop

Update **Where I left off** in the Brief: what was done, what is next, any `(you)` tasks waiting on the user, and anything a fresh chat must know. Then tell the user the workbook is current and it is safe to start a new chat.
