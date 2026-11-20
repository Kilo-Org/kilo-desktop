import { ruleTester } from "../test/rule-tester.ts";
import noHooklessUseFunction from "./no-hookless-use-function.ts";

ruleTester.run("no-hookless-use-function", noHooklessUseFunction, {
	valid: [
		"function useCount() { return useState(0); }",
		"const useTheme = () => use(ThemeContext);",
		"const useLabel = function () { return React.useContext(Labels); };",
		"function count() { return 1; }",
		"function user() { return 1; }",
	],
	invalid: [
		{ code: "function useDragSource(refs) { return { draggable: true, refs }; }", errors: 1 },
		{ code: "const useLabel = () => 'x';", errors: 1 },
		{
			code: "function useLater() { return () => useState(0); }",
			errors: [{ message: /calls no hooks/ }],
		},
	],
});
