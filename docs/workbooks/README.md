# Workbooks

A workbook is where the information from chats about one piece of work is kept, by the user and by several agents, so that work outlives any one chat or session. Workbooks are created from **workbook templates**. Design and decisions live in the workbooks themselves (see "Workbooks (Spike)" and "Workbooks: first cut" in Pages).

The pre-rolled templates (Coding; Blank) live in `plugins/workbooks/templates/` and ship as built-ins through kilo.workbooks' own `kilo.workbooks/template` extension point; other plugins contribute templates the same way. A contribution's `read()` returns the template with its content resolved (`WorkbookTemplate` in kilo.workbooks' contracts); invalid templates are skipped and reported in `kilo.workbooks/templates`.

## Template format

```
<id>/
  workbook.json   # name, description, Brief fields, first move, sections
  AGENTS.md       # agent guide, copied to the workbook's "How to work here" page
  pages/*.md      # starter content for the Brief and each section
```

- **Copied once.** Creating a workbook copies the template into a Pages Project: `pages/brief.md` (with `{{field}}` placeholders filled from the Brief fields) becomes the Project document, the guide and every section become Pages. After that the workbook owns its content; changing a template never changes existing workbooks.
- **All sections are created up front**, so people, agents and the app always find them.
- **Item types** are the shared vocabulary every template is built from: `plan-step`, `task`, `decision`, `finding`, `question`, `reference`, `artifact`, `note`. Each section declares the item type it holds; the app and the workbook tools address sections by id and item type, never by title.
- **Item formats** are defined in the guide. Workbook tools (agent tools contributed by `kilo.workbooks`, which find the calling session's active workbook) own the write path and guarantee them; until they exist, agents write the formats with the Pages MCP tools.
- **The app reaches Pages through Kilo's Pages MCP connection** (the user signs in to the `pages` MCP entry), and starting a session from a workbook injects its Brief and guide into the first prompt.

## In the app (prototype, behind the `workbooks` flag)

- **Start from a workbook:** two tiles on the New Session page (`kilo.work-sessions/new-work-session-section`), styled like its tool tiles. **New workbook** opens a two-step wizard (as Add AI Provider): choose a template from a compact grid, filterable once there are many (Coding, or Blank: just a Brief and a Notes page), then name it and fill in its Brief, optional fields folded into More details; **Existing workbook** (disabled until the workspace has one) opens a dialog with a resume view: where it left off, plan progress, open items and suggested next steps. The session starts where the page says (workspace, isolation); its composer holds a kick-off message carrying the Brief, the guide and the first move or chosen step, for the person to send.
- **Workbook tools** (`desktop_workbooks_*`): `read_workbook`, `add_plan_step`, `set_step_status`, `record_decision`, `file_item`, `set_where_i_left_off`. They find the chat's workbook from its work session and write the guide's formats.
- **In chats:** the open session's header shows its workbook; workbook tool calls render as one-line filing receipts.
- **Pages** is reached through Kilo's own MCP connection to the user's `pages` server, from the workspace's primary folder; kilo.workbooks is one of kilo.core's Kilo-server clients for this.
