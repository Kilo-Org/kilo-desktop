import { defineRule, type ESTree } from "@oxlint/plugins";

import { callsHook, isHookName, type FunctionNode } from "./functions.ts";

export default defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow use* functions that call no hooks: React Compiler leaves them uncompiled, so what they return is rebuilt on every render.",
		},
		schema: [],
	},
	create(context) {
		const check = (name: string, fn: FunctionNode, node: ESTree.Node) => {
			if (!isHookName(name) || callsHook(fn)) return;
			context.report({
				node,
				message: `"${name}" calls no hooks, so React Compiler skips it and what it returns is rebuilt on every render. Rename it to a plain function, or read the hook it depends on inside it.`,
			});
		};
		return {
			FunctionDeclaration(node) {
				if (node.id) check(node.id.name, node, node.id);
			},
			VariableDeclarator(node) {
				if (node.id.type !== "Identifier" || !node.init) return;
				if (
					node.init.type !== "ArrowFunctionExpression" &&
					node.init.type !== "FunctionExpression"
				) {
					return;
				}
				check(node.id.name, node.init, node.id);
			},
		};
	},
});
