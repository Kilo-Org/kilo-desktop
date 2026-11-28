# Workbooks

A workbook is where the information from chats about one piece of work is kept, by the user and by several agents, so that work outlives any one chat or session. Workbooks are created from **workbook templates**. Design and decisions live in the workbooks themselves (see "Workbooks (Spike)" and "Workbooks: first cut" in Pages).

The pre-rolled templates (Coding; Blank) live in `plugins/workbooks/templates/` and ship as built-ins through kilo.workbooks' own `kilo.workbooks/template` extension point; other plugins contribute templates the same way. A contribution's `read()` returns the template with its content resolved (`WorkbookTemplate` in kilo.workbooks' contracts); invalid templates are skipped and reported in `kilo.workbooks/templates`.

## The model

A workbook is made of **pages**, and pages hold **sections**. One page is **home**: the Project's own document (the Brief). Every section has a **section type** from a catalogue the app fixes (`SECTION_CATALOGUE` in `src/contracts/templates.ts`). Like a pre-printed stationery insert, a section type comes finished: its format, rules, behaviour, starting content, default title, default label and built-in instructions for agents are all fixed. A template only picks section types and arranges them on pages, and per section may set its words:

- **`title`:** its heading (defaults to the section type's own).
- **`collects`:** what belongs in it, in plain words (defaults to the section type's label). It is shown under the heading and given to every chat, so agents file things where they belong; Decisions and Findings are both `log` sections with different `collects`.
- **`instructions`:** how to work with it in this kind of work, added after the section type's own. The Coding template's plan adds "each step ends in one commit", which the plan section type never says.

Nothing else is configurable. Each section type is implemented on its own in `src/main/inserts/` (its format, rules and tool actions), so one can change without touching the others.

| Section type | Default title         | How many       | Fixed behaviour                                                                                                                                                                              |
| ------------ | --------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goal`       | Goal                  | one (required) | the wizard's required question; shown first in every chat; changed only with the user's say-so                                                                                               |
| `plan`       | Plan                  | one            | numbered steps with tasks, starting with "Refine the Brief and draft this Plan"; done only once its tasks are ticked, with what it achieved (a link is optional); progress and the next step |
| `handoff`    | Where we left off     | one            | the latest handoff, read first by every new chat; each entry is also added to the change log                                                                                                 |
| `activity`   | Who's working on what | one            | who is working now, kept up to date by the tools; entries older than 12 hours are dropped                                                                                                    |
| `change-log` | Change Log            | one            | every handoff, newest first                                                                                                                                                                  |
| `todo`       | To do                 | any            | tick boxes                                                                                                                                                                                   |
| `log`        | Log                   | any            | dated entries, newest first; a wrong or reversed entry is superseded, never deleted                                                                                                          |
| `questions`  | Open questions        | any            | answering records the answer in a log the agent names, then the question goes                                                                                                                |
| `notes`      | Notes                 | any            | free writing, replaced whole; the Brief's first notes section is the wizard's optional context question                                                                                      |
| `output`     | Result                | any            | the result being built: parts under subheadings, added, revised or rewritten whole                                                                                                           |

Every workbook's first move is the same: refine the Brief, draft the Plan, and stop for the user to confirm.

## Template format

```
<id>/
  workbook.json   # name, description, icon, pages and their sections
  AGENTS.md       # agent guide, copied to the workbook's "How to work here" page
```

```json
{
	"schemaVersion": 3,
	"id": "coding",
	"name": "Coding",
	"description": "…",
	"pages": [
		{ "title": "Brief", "home": true, "sections": [{ "type": "goal" }, { "type": "handoff" }] },
		{
			"title": "Plan",
			"sections": [{ "type": "plan", "instructions": "Each step ends in one commit…" }]
		},
		{
			"title": "Decisions & findings",
			"sections": [
				{ "type": "log", "title": "Decisions", "collects": "Choices the user made or confirmed…" },
				{ "type": "log", "title": "Findings", "collects": "Facts learned while working…" }
			]
		}
	]
}
```

- A page other than home with one section is that section: no heading, titled by the page. Otherwise each section lives under `## <title>`.
- Section ids are automatic: the section type for one a workbook has once (`goal`, `plan`…), otherwise the title's slug (`decisions`, `acceptance-criteria`) or the page's.
- **Copied once.** Creating a workbook writes every page from its sections, with the home page as the Project document. After that the workbook owns its content, and records each section's type, words and place, so the tools need nothing else.
- **Templates are validated** (one home page, a goal, at most one of each one-per-workbook type, no two sections with the same id, no unknown keys); invalid ones are skipped and reported in `kilo.workbooks/templates`.
- **The app reaches Pages through Kilo's Pages MCP connection** (the user signs in to the `pages` MCP entry), and every chat in a session on a workbook is given its sections, Brief and guide as instructions (`kilo.core/chat-config`, read from Pages on the chat's first send).

## Where templates come from

- **Built-in:** `plugins/workbooks/templates/<id>/` (Coding, Blank), shipped through kilo.workbooks' own `kilo.workbooks/template` point.
- **Other plugins:** any plugin can implement `kilo.workbooks/template` with a `read()` returning a template.
- **The person's own:** made by asking an agent, kept in kilo.workbooks' plugin data folder as `templates/<id>/workbook.json` and `AGENTS.md` (the same files as a built-in). They are read before the template list is provided at startup, and again after every save or delete; there is no file watcher, so edits made outside the app show after the next save or a restart. The agent tools:
  - `read_templates`: lists every template on offer and any of the person's that can't be read; describes the section types and the format; or reads one template in full, to copy or change.
  - `save_template`: checks a template (its `workbook.json` content plus the guide's markdown) against the schema, reporting every problem, then writes it; a built-in's id is refused, and the same id replaces the person's earlier version. The New workbook wizard offers it straight away.
  - `delete_template`: removes one of the person's; workbooks made from it keep working, since a workbook is a copy.

Contributions are taken first, in priority order, then the person's own; a repeated id is skipped and reported.

## In the app (prototype, behind the `workbooks` flag)

- **Working in a workbook:** a centred row above the New Session page's location row (Workspace, Use, Branch) holds **Workbook** (a `kilo.work-sessions/new-work-session-setting`): a searchable picker built to the dropdown standard (`packages/ui/src/lib/menu-styles.ts`, as the workspace picker: every workbook, those used in the page's workspace first, then the rest by last use; **No workbook** to clear it; **New workbook** pinned under the list). Choosing starts nothing: whatever the page then starts (a first message, a tool, an empty session) is put in the workbook before it opens, so its chats get the workbook's instructions. Choosing a workbook also suggests a short first message in the New Session draft (`kilo.chat/composer` `prefillNewSession`), never over text you typed: the template's first move for a workbook just made here, otherwise say where it was left and what's next. Send it, edit it, or write your own. With no say on what to work on, the agent says where it was left and what's next, then lets you decide; in a new workbook it makes the guide's first move. The choice stays for later sessions, as the workspace does. New workbook opens a two-step wizard (as Add AI Provider): choose a template from a compact grid, filterable once there are many (Coding, or Blank: just a Brief and a Notes page), then name it and fill in its Brief, optional fields folded into More details; it selects the workbook it makes.
- **Workbook tools** (`desktop_workbooks_*`), in the model's terms: `read_workbook`, `add_item` (any section; a journal entry can supersede another), `add_task`, `set_task_done`, `set_status` (steps and checklist items), `edit_step`, `move_step` and `remove_item` (re-cutting the plan; steps renumber), `supersede`, `answer_question`, `write_section` (goal and notes whole; an output whole or one `part`; the goal only with the user's say-so), `hand_off` and `set_activity`. They find the chat's workbook from its work session, write each type's format and enforce the section's rules.
- **In chats:** the open session's header shows its workbook; workbook tool calls render as one-line filing receipts.
- **Pages decides which workbooks exist.** A workbook is a Pages Project whose description starts with the marker `Workbook · <template name> (<template id>)`. The picker refreshes the list from Pages when it shows and when it opens: it lists the marked Projects, shared ones included, and finds their guide and sections by the template's page titles (the template's, or every known template's when the template isn't on offer). A workbook's id is its Pages project id, so it's the same workbook on every machine; the app keeps the last list found, so it shows at once and offline.
- **Workbooks belong to the person, not a workspace.** Each reference records the workspaces it has been used in (starting a session on it records the session's workspace; creating it in one counts as the first use) and when it was last used. This only orders the picker, so work that spans workspaces, or happens outside any, keeps one workbook. This usage is kept on this machine only.
- **Pages** is reached through Kilo's own MCP connection to the user's `pages` server, on Kilo's global instance (not any one folder), so the `pages` entry must be in global Kilo config; kilo.workbooks is one of kilo.core's Kilo-server clients for this.
