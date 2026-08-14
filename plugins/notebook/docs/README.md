# Notebook integration docs

Embedding nteract's notebook UI while attaching to the user's installed `runtimed`
singleton. Agentic Desktop stages notebook web assets but does not package, install,
spawn, stop, or replace the daemon. These docs were written as work progressed, so
several preserve superseded investigations. Read in this order.

| Doc                                                                              | What it is                                                                           |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [integration-brief.md](./integration-brief.md)                                   | Current product flow, security boundary, release order, and limitations. Start here. |
| [embedding-decisions.md](./embedding-decisions.md)                               | Why the design is shaped this way (D1–D7), including options rejected.               |
| [embedding-handoff.md](./embedding-handoff.md)                                   | Overall state and work breakdown. Its sections 3–4 are superseded — see the banner.  |
| [protocol-csp-handoff.md](./protocol-csp-handoff.md)                             | Serving nteract's SPA from our protocol, plus CSP. Done.                             |
| [decisions-for-review.md](./decisions-for-review.md)                             | Remaining release and ownership decisions; closed architecture choices are listed.   |
| [runtimed-standalone-daemon-handoff.md](./runtimed-standalone-daemon-handoff.md) | **Superseded.** Historical daemon-bundling investigation.                            |
| [runtimed-private-instance-handoff.md](./runtimed-private-instance-handoff.md)   | **Superseded.** Historical private-daemon investigation.                             |
| [runtimed-wheel-handoff.md](./runtimed-wheel-handoff.md)                         | **Superseded.** The Python-wheel route, kept for the reasoning trail.                |
