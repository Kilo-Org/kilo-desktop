import type { ConfigEntry, PermissionRule } from "@kilocode/client";

/** Kilo v2's config document, as `config.get` reads it and `kilo2.jsonc` holds it. */
type KiloConfigDocument = Extract<ConfigEntry, { readonly type: "document" }>["info"];

/** A `mcp.servers.<name>` entry. */
export type KiloMcpServer = NonNullable<NonNullable<KiloConfigDocument["mcp"]>["servers"]>[string];
/** A `providers.<id>` entry. */
export type KiloProvider = NonNullable<KiloConfigDocument["providers"]>[string];
/** An `agents.<id>` entry. */
export type KiloAgent = NonNullable<KiloConfigDocument["agents"]>[string];
/** A `commands.<id>` entry. */
export type KiloCommand = NonNullable<KiloConfigDocument["commands"]>[string];
/** A model selection, as agents and commands name theirs. */
export type KiloModelSelection = Exclude<NonNullable<KiloAgent["model"]>, string>;

export type KiloPermissionRule = PermissionRule;
