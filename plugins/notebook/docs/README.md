# Notebook integration docs

Embedding nteract's notebook UI while sharing the user's `runtimed` singleton. Kilo
Desktop packages a pinned daemon and warms it during app launch when the canonical endpoint
is idle; an already-running compatible daemon always wins. Kilo reaches that daemon through a
Desktop-managed plugin using `@runtimed/node` directly. Start with the integration brief.

> The plugin is the kernel plugin `kilo.notebook`: notebooks are panes (its `notebook`
> contribution to `kilo.work-sessions/pane-kind`) in a work session's layout rather than tabs in
> Kilo's chat right panel, and mentions below of `mainRegister`, feature-sdk capabilities or the
> `chat-right-panel-tab` zone describe the earlier shape. What the plugin offers and uses today is
> in [docs/plugins/schema.md](../../../docs/plugins/schema.md) and its `plugin.json`.

| Doc                                                | What it is                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [integration-brief.md](./integration-brief.md)     | Current product flow, security boundary, release order, and limitations. Start here. |
| [embedding-decisions.md](./embedding-decisions.md) | Why the design is shaped this way (D1–D9), including options rejected.               |
