---
name: design-feature
description: >-
  Design a Kilo Desktop feature in plugin building blocks — plugins, domain
  objects, object types, extension points, contributions, commands, context
  keys, services, flags — before writing code. Use at the start of any new
  feature, change to a user-facing surface, or cross-plugin behaviour, when
  deciding where code should live, or when the user asks "how should we build
  X", "which plugin owns this", or "do we need a new extension point".
---

# Design a feature in building blocks

Every feature in Kilo Desktop is built from the same blocks the kernel offers.
Decide which blocks a feature uses **before** writing code, write the result
down, then build it (with the `write-plugin` skill for plugin work and the
`tdd` skill for logic).

Read first: [Building blocks](../../../docs/plugin-architecture.md#building-blocks)
and [Designing a feature](../../../docs/plugin-architecture.md#designing-a-feature).
The generated [schema](../../../docs/plugins/schema.md) lists every plugin,
extension point, domain object, object type and context key that exists:
search it before inventing anything.

## Workflow

1. **Name the product concept** in the product's words (work session, chat,
   workspace, pane, AI provider, model…). See the shared vocabulary in
   [Conventions](../../../docs/plugin-architecture.md#conventions).
2. **Find the owner.** Which plugin owns that concept (schema → Plugins and
   Domain objects)? A plugin is a product area, not a concept: put the
   feature in its owner as a new area. Propose a new plugin only for a new
   product area, or when something must ship, run or be removed without it.
   Check its layer: it may require only lower layers
   ([Layers and plugins](../../../docs/plugin-architecture.md#layers-and-plugins)).
3. **State → domain objects.** List the state and actions other plugins (or
   the owner's other half) need. Extend the owner's domain object, or add one
   (`home: "main"` for shared state, `"renderer"` for per-window). A
   collection is plural, has a `lookup`, and an object type if others refer
   to its items. Never copy another plugin's state; read its domain object.
4. **UI → contributions.** For each piece of UI, find the existing extension
   point it belongs in (schema → Extension points: pane kinds, settings
   sections, composer actions, work session menu items and decorations,
   top-bar actions, dialogs, onboarding steps…). If the feature would need an
   edit to *another* plugin's surface, that surface is missing an extension
   point — design one there instead of a special case.
5. **Actions → method + command + tool.** A domain object method for code, a
   `kernel/command` for people (palette, keys, menus and buttons reference its
   id), a `kilo.core/tool` when the agent should do it too.
6. **Conditions → context keys.** Visibility and enablement are `when` clauses
   over keys owned by the concept's plugin. Unfinished work goes behind a
   `kernel/flag`.
7. **Slow work → services.** Child processes and slow startup work are a
   `kernel/service` (prefer `startOn: "first-use"`).
8. **New extension point? Only for others.** Add one only if something outside
   the owner will contribute (another bundled plugin, or third parties by
   design). Product-named, singular, right kind (additive / exclusive /
   decision), typed metadata and implementation; ship the owner's built-ins
   through it. If a lower layer needs something from a higher one, the lower
   layer declares the point and the higher one fills it.
9. **Removability.** Say what happens without the plugin and without each
   thing it requires (`optional` requires, `null` domain objects, empty
   extension points).
10. **Write it down** (issue, PR description or plan) in this shape, then get
    agreement before building anything large:

```md
### Design: <feature>
- Owner: kilo.<plugin> (new area `src/<main|web>/<area>`) | new plugin kilo.<x> (why)
- Domain objects: kilo.<plugin>/<name> (home, new / changed state, methods, events)
- Object types: …
- Contributes to: <point> → <what> (one line each)
- New extension points: <id> (kind, who contributes, why it can't be plain code)
- Commands / tools: …
- Context keys / flags: …
- Services: …
- Telemetry events: …
- Without it / without its requirements: …
- Extensibility map rows added: …
```

## After building

- `pnpm docs:schema` after any manifest or contract definition change
  (`pnpm lint` fails until the schema doc is current).
- Add candidate extension points you spotted to the
  [extensibility map](../../../docs/plugin-architecture.md#extensibility-map);
  remove a candidate once it is built.
- Record decisions left open in
  [Open decisions and follow-ups](../../../docs/plugin-architecture.md#open-decisions-and-follow-ups).
- A new plugin also gets a line in `CONTEXT.md`, registration in
  `packages/bundled-plugins` and both entry maps, and an `@smoke` e2e spec.

## Red flags

- Importing another plugin's code (anything but its `./contracts`).
- Product code in `apps/*` or the kernel naming a plugin.
- A special case for one feature inside a host surface.
- React context, shared storage or a mirrored copy of state across plugins.
- An extension point only its owner contributes to, with no third party in
  mind.
- A plugin requiring a higher layer.
- Slow work in `activate`.
