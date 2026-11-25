// A long, realistic session for performance benchmarks: every turn is a
// prompt and a reply that reads, edits and runs things before answering in
// markdown, the shape that makes long agent sessions heavy.
import type { SessionMessageInfo } from "@kilocode/client";

import {
	assistantMessage,
	idleMessage,
	reasoning,
	text,
	tool,
	userMessage,
} from "./kilo2/fixtures";

const PARAGRAPH =
	"The `login` handler in src/auth/login.ts posts the credentials to the session endpoint, " +
	"then stores the returned token. See **src/auth/session.ts** for the refresh path and " +
	"[the docs](https://example.com/docs/auth) for the protocol.";

const answer = (turn: number) =>
	[
		`## Turn ${turn}: what changed`,
		PARAGRAPH,
		"- Validates the form before posting\n- Retries once on a 503\n- Clears the token on logout",
		"```ts\nexport async function login(user: string, password: string) {\n\tconst res = await post('/session', { user, password });\n\treturn res.token;\n}\n```",
		PARAGRAPH,
		`Final answer for turn ${turn}.`,
	].join("\n\n");

const sourceFile = (turn: number, lines = 60) =>
	Array.from(
		{ length: lines },
		(_, line) => `export const value${turn}_${line} = compute(${line}, "${"x".repeat(24)}");`,
	).join("\n");

/** The `turn`th prompt and its finished reply (one step that reads, edits and runs, then answers). */
export function longSessionTurn(turn: number): SessionMessageInfo[] {
	const before = sourceFile(turn);
	const after = before.replace(/compute\(1/g, "computeFast(1");
	const path = `/projects/app/src/file${turn}.ts`;
	return [
		userMessage(`Question ${turn}: what does login do?`, { id: `msg_${turn}_u` }),
		assistantMessage(
			[
				reasoning(`Looking at the login flow for turn ${turn}.`),
				tool("read", { path }, before, { id: `call_${turn}_read` }),
				tool("edit", { path, oldString: before, newString: after }, "Edit applied", {
					id: `call_${turn}_edit`,
				}),
				tool("shell", { command: "pnpm test", description: "Run tests" }, "ok\n".repeat(40), {
					id: `call_${turn}_shell`,
				}),
				text(answer(turn)),
			],
			{ id: `msg_${turn}_a`, finish: "stop", rawFinish: "stop" },
		),
		idleMessage(),
	];
}

/** A session of `turns` finished turns. */
export function longSession(turns: number): SessionMessageInfo[] {
	return Array.from({ length: turns }, (_, index) => longSessionTurn(index + 1)).flat();
}
