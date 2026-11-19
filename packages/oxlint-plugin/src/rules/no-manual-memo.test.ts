import { ruleTester } from "../test/rule-tester.ts";
import noManualMemo from "./no-manual-memo.ts";

ruleTester.run("no-manual-memo", noManualMemo, {
	valid: [
		"const total = items.length * 2;",
		"const onClick = useStableCallback(() => save());",
		"const ref = React.useRef(null);",
		'function Panel() { "use client"; return null; }',
		'const label = "use no memo";',
		{
			code: "const total = useMemo(() => items.length, [items]);",
			options: [{ allowMemoHooks: true }],
		},
		{
			code: 'function Grid() { "use no memo"; return null; }',
			options: [{ allowDirectives: true }],
		},
	],
	invalid: [
		{ code: "const total = useMemo(() => items.length, [items]);", errors: 1 },
		{ code: "const onClick = useCallback(() => save(), []);", errors: 1 },
		{ code: "const total = React.useMemo(() => items.length, [items]);", errors: 1 },
		{ code: 'function Panel() { "use no memo"; return null; }', errors: 1 },
		{ code: 'function useTotal(items) { "use memo"; return items.length; }', errors: 1 },
		{ code: '"use no forget";\nexport const a = 1;', errors: 1 },
		{
			code: 'function Panel() { "use no memo"; return null; }',
			options: [{ allowMemoHooks: true }],
			errors: 1,
		},
	],
});
