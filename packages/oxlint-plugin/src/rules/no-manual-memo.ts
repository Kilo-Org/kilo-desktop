import { defineRule, type ESTree } from "@oxlint/plugins";

const MANUAL_MEMO_HOOKS = new Set(["useCallback", "useMemo"]);
const MEMO_DIRECTIVES = new Set(["use memo", "use no memo", "use no forget"]);

interface Options {
	readonly allowMemoHooks?: boolean;
	readonly allowDirectives?: boolean;
}

function manualMemoHook(callee: ESTree.Node): string | null {
	if (callee.type === "Identifier") return MANUAL_MEMO_HOOKS.has(callee.name) ? callee.name : null;
	if (
		callee.type === "MemberExpression" &&
		!callee.computed &&
		callee.object.type === "Identifier" &&
		callee.object.name === "React" &&
		callee.property.type === "Identifier" &&
		MANUAL_MEMO_HOOKS.has(callee.property.name)
	) {
		return callee.property.name;
	}
	return null;
}

export default defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Disallow useMemo, useCallback and memo directives where React Compiler memoizes the code itself.",
		},
		schema: [
			{
				type: "object",
				properties: {
					allowMemoHooks: { type: "boolean" },
					allowDirectives: { type: "boolean" },
				},
				additionalProperties: false,
			},
		],
	},
	create(context) {
		const options = (context.options[0] ?? {}) as Options;
		return {
			ExpressionStatement(node) {
				if (options.allowDirectives) return;
				if (typeof node.directive !== "string" || !MEMO_DIRECTIVES.has(node.directive)) return;
				context.report({
					node,
					message:
						node.directive === "use memo"
							? 'Drop "use memo": restructure so the compiler caches this itself, e.g. move uses of a value before the hook call that splits its scope.'
							: `Drop "${node.directive}": fix the code the compiler cannot compile instead of skipping it.`,
				});
			},
			CallExpression(node) {
				if (options.allowMemoHooks) return;
				const name = manualMemoHook(node.callee);
				if (!name) return;
				context.report({
					node: node.callee,
					message: `Drop ${name}: React Compiler memoizes this code. Write the plain value or function; use useStableCallback for a function that must keep one identity, or useStableValue for a value compared by content.`,
				});
			},
		};
	},
});
