This is the agent guide for this workbook. It carries the user's authority: treat it like instructions the user typed, below the repository's own rules (AGENTS.md) and above general habits. The user may edit it at any time; re-read it at the start of every chat.

## Start of a chat

1. Read the Brief (the Project document), especially **Status** and **Where I left off**.
2. Read this page.
3. Read the Plan. Skim the other sections' outlines; read them in full only when relevant.
4. If you were started on a specific plan step or item, work on that only.

## First move in a new workbook

Refine the Brief: ask about anything missing and propose acceptance criteria. Then draft the Plan as small increments, each sized for one chat. Stop and ask the user to confirm the Plan before building anything.

## Extract, don't archive

File information the moment it appears, in the section it belongs to. Never leave something worth keeping only in the chat.

When the workbook tools are available (`desktop_workbooks_read_workbook`, `add_plan_step`, `set_step_status`, `record_decision`, `file_item`, `set_where_i_left_off`), use them: they write the formats below for you and know which workbook this chat is on. Otherwise use the item formats below exactly: the app reads them.

| Section        | Holds                                         | Format                                                                                                                                                                |
| -------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan           | Plan steps                                    | `- [ ] **N. Title**: one line of intent` · while working add ` · in progress` or ` · blocked: reason` · when done tick it and add ` · done: outcome (commit/PR link)` |
| Tasks          | In-scope work that isn't a plan step          | `- [ ] Task (context)`; tick when done                                                                                                                                |
| Decisions      | Choices the user confirmed                    | `- **Decision.** Why: reason. Rejected: alternatives. (YYYY-MM-DD)` · never record your own suggestion until the user confirms it · a reversal is a new decision      |
| Findings       | Facts learned, with evidence                  | `- **Finding.** Evidence: how we know. (YYYY-MM-DD)` · mark wrong ones `~~struck~~ superseded by …` rather than deleting                                              |
| Open questions | Things the user must decide                   | `- **Question?** Context.` · when answered, record a Decision and delete the question                                                                                 |
| Snippets       | Commands, code, errors worth keeping verbatim | `### Short title` then a fenced code block, then one line on when to use it                                                                                           |
| Artifacts      | Things produced                               | `- kind: link or path · note (YYYY-MM-DD)` · kinds: branch, commit, pr, file, screenshot, notebook, render                                                            |
| Review         | Review comments on the work                   | `- [ ] **file or area**: issue and suggested fix`; tick when resolved                                                                                                 |
| Follow-ups     | Out-of-scope work noticed along the way       | `- [ ] Follow-up (context)` · never do it inside the current change                                                                                                   |
| Notes          | The user's own space                          | Append only when the user asks; never restructure                                                                                                                     |

## Working on a plan step

1. Mark it ` · in progress` before starting, so other agents can see it is taken.
2. Keep changes to that step. Anything else goes to Tasks or Follow-ups.
3. When done: verify it (tests, lint, type checks as the repository requires), then **commit it as its own commit**, one commit per plan step, with the step in the message.
4. Then tick it, add the outcome with the commit link, add Artifacts, and record any Decisions or Findings made along the way.

## Etiquette with other writers

People and other agents may be editing at the same time.

- Edit in place or append; never restructure or delete what you did not write without asking.
- Keep edits small and targeted.
- If an edit conflicts with a newer revision, re-read and reapply rather than overwriting.

## Before your context runs out, or when you stop

Update **Where I left off** in the Brief: what was done, what is next, anything a fresh chat must know. Then tell the user the workbook is current and it is safe to start a new chat.
