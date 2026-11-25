// Upstream imports `@opencode-ai/sdk/v2/client`. This copy keeps the v1 Kilo
// SDK's message and session types as its thread state's vocabulary until the
// transcript moves to Kilo v2's shapes; its server calls are Kilo v2's
// (`@kilocode/client`, see kilo.ts).
export type * from "@kilocode/sdk/v2/client";
