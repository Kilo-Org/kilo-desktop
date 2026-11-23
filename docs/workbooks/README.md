# Workbooks

A workbook is where the information from chats about one piece of work is kept, by the user and by several agents, so that work outlives any one chat or session. Workbooks are created from **workbook templates**. Design and decisions live in the workbooks themselves (see "Workbooks (Spike)" and "Workbooks: first cut" in Pages).

The pre-rolled templates (Coding; Blank) live in `plugins/workbooks/templates/` and ship as built-ins through kilo.workbooks' own `kilo.workbooks/template` extension point; other plugins contribute templates the same way. A contribution's `read()` returns the template with its content resolved (`WorkbookTemplate` in kilo.workbooks' contracts); invalid templates are skipped and reported in `kilo.workbooks/templates`.

## The model

A workbook is made of **pages**, and pages hold **sections**. One page is **home**: the Project's own document (the Brief). The vocabulary is fixed by the app; a template picks from it, names it and describes it (the "Workbooks explained" page in Pages has the full picture):

- **Section type** (`type`): how a section's items are written and change, in `plugins/workbooks/src/main/items.ts`.
  - `steps`: numbered work with indented tasks; todo → in progress → blocked → done (with a result).
  - `checklist`: independent checkboxes.
  - `journal`: dated entries, newest or oldest first, with the section's labelled `fields`; a wrong or reversed entry is struck through as superseded, never deleted.
  - `questions`: things only the user can decide; answering one can record it in a journal.
  - `text`: prose, replaced whole.
- **Role** (`role`, optional): what the app does with a section; a role implies its type, and each is held by at most one section.
  - `goal` (text; required): shown with the workbook, first in every chat's instructions, filled from the wizard's required field, and changed only with the user's say-so.
  - `plan` (steps): progress and the next step.
  - `handoff` (journal): Where we left off, holding only the latest entry; `history` names the journal that keeps every earlier one (the Coding template's Change Log).
- **Collects** (`collects`): in plain words, what belongs in a section. It is shown under its heading and given to every chat, so agents file things where they belong. This is how a template gives sections their meaning without new code.
- **Rules** the tools enforce: `requires` on steps (`tasks-ticked`, `link-or-reason`), `fields` and `order` on journals, `protected` on text, `history` on the handoff. Behaviour the tools can't check (commit each step on its own) stays in the guide.

## Template format

```
<id>/
  workbook.json   # name, description, intake, first move, pages and their sections
  AGENTS.md       # agent guide, copied to the workbook's "How to work here" page
```

- **Pages and sections are data** in `workbook.json` (`schemaVersion: 2`). A section with a `title` is the part of its page under `## <title>`; a page's one untitled section is the whole page (the Coding template's Follow-ups and Change Log). A page can carry intro prose from a file (`introFile`).
- **Intake fields** are the wizard's questions; each `fills` a text section, and a required one must fill the goal.
- **Copied once.** Creating a workbook writes every page from its sections (each heading, its `collects` line, intake answers and any `starter` steps), with the home page as the Project document. After that the workbook owns its content; changing a template never changes existing workbooks. Each workbook records its sections (type, role, rules and where they live), so the tools need nothing else.
- **Templates are validated** against the vocabulary (one goal, a type or role on every section, rules only where they apply); invalid ones are skipped and reported in `kilo.workbooks/templates`.
- **The app reaches Pages through Kilo's Pages MCP connection** (the user signs in to the `pages` MCP entry), and every chat in a session on a workbook is given its sections, Brief and guide as instructions (`kilo.core/chat-config`, read from Pages on the chat's first send).

## In the app (prototype, behind the `workbooks` flag)

- **Working in a workbook:** a centred row above the New Session page's location row (Workspace, Use, Branch) holds **Workbook** (a `kilo.work-sessions/new-work-session-setting`): a searchable picker built to the dropdown standard (`packages/ui/src/lib/menu-styles.ts`, as the workspace picker: every workbook, those used in the page's workspace first, then the rest by last use; **No workbook** to clear it; **New workbook** pinned under the list). Choosing starts nothing: whatever the page then starts (a first message, a tool, an empty session) is put in the workbook before it opens, so its chats get the workbook's instructions. Choosing a workbook also suggests a short first message in the New Session draft (`kilo.chat/composer` `prefillNewSession`), never over text you typed: the template's first move for a workbook just made here, otherwise say where it was left and what's next. Send it, edit it, or write your own. With no say on what to work on, the agent says where it was left and what's next, then lets you decide; in a new workbook it makes the guide's first move. The choice stays for later sessions, as the workspace does. New workbook opens a two-step wizard (as Add AI Provider): choose a template from a compact grid, filterable once there are many (Coding, or Blank: just a Brief and a Notes page), then name it and fill in its Brief, optional fields folded into More details; it selects the workbook it makes.
- **Workbook tools** (`desktop_workbooks_*`), in the model's terms: `read_workbook`, `add_item` (any section; a journal entry can supersede another), `add_task`, `set_task_done`, `set_status` (steps and checklist items), `edit_step`, `move_step` and `remove_item` (re-cutting the plan; steps renumber), `supersede`, `answer_question`, `write_section` (text; the goal only with the user's say-so) and `hand_off`. They find the chat's workbook from its work session, write each type's format and enforce the section's rules.
- **In chats:** the open session's header shows its workbook; workbook tool calls render as one-line filing receipts.
- **Pages decides which workbooks exist.** A workbook is a Pages Project whose description starts with the marker `Workbook · <template name> (<template id>)`. The picker refreshes the list from Pages when it shows and when it opens: it lists the marked Projects, shared ones included, and finds their guide and sections by the template's page titles (the template's, or every known template's when the template isn't on offer). A workbook's id is its Pages project id, so it's the same workbook on every machine; the app keeps the last list found, so it shows at once and offline.
- **Workbooks belong to the person, not a workspace.** Each reference records the workspaces it has been used in (starting a session on it records the session's workspace; creating it in one counts as the first use) and when it was last used. This only orders the picker, so work that spans workspaces, or happens outside any, keeps one workbook. This usage is kept on this machine only.
- **Pages** is reached through Kilo's own MCP connection to the user's `pages` server, on Kilo's global instance (not any one folder), so the `pages` entry must be in global Kilo config; kilo.workbooks is one of kilo.core's Kilo-server clients for this.
