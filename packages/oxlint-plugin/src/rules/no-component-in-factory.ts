import { defineRule, type ESTree } from "@oxlint/plugins";

import {
	callsHook,
	functionName,
	isComponentName,
	isFunctionNode,
	isHookName,
	optsOut,
	type FunctionNode,
} from "./functions.ts";

const compiles = (name: string | undefined) =>
	name !== undefined && (isComponentName(name) || isHookName(name));

function enclosingFunction(node: ESTree.Node): FunctionNode | undefined {
	let parent = node.parent;
	while (parent && !isFunctionNode(parent)) parent = parent.parent;
	return parent ?? undefined;
}

/**
 * React Compiler compiles components and hooks declared at module level or
 * inside another component or hook. One declared in a plain function (a
 * factory or HOC) is skipped without a diagnostic. A hook-free wrapper that only
 * renders a module-level component loses nothing, so only functions calling
 * hooks are reported.
 */
export default defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow components and hooks declared inside a plain function, which React Compiler never compiles.",
		},
		schema: [],
	},
	create(context) {
		const check = (fn: FunctionNode) => {
			const name = functionName(fn);
			if (!compiles(name) || optsOut(fn) || !callsHook(fn)) return;
			const factory = enclosingFunction(fn);
			if (!factory) return;
			for (let outer: FunctionNode | undefined = factory; outer; outer = enclosingFunction(outer)) {
				if (compiles(functionName(outer))) return;
			}
			context.report({
				node: fn,
				message: `${name} is defined inside ${functionName(factory) ?? "a plain function"}, so React Compiler never compiles it. Declare it at module level and pass what it closes over as props.`,
			});
		};
		return {
			FunctionDeclaration: check,
			FunctionExpression: check,
			ArrowFunctionExpression: check,
		};
	},
});
