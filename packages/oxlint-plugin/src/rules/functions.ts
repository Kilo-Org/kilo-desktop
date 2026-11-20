import type { ESTree } from "@oxlint/plugins";

export type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression;

export function isFunctionNode(node: ESTree.Node): node is FunctionNode {
	return (
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression" ||
		node.type === "ArrowFunctionExpression"
	);
}

// Bare `use` is React 19's `use(promise | context)`, a hook call too.
const HOOK_CALLEE = /^use(?:[A-Z0-9]|$)/;

export const isHookName = (name: string): boolean => /^use[A-Z0-9]/.test(name);
export const isComponentName = (name: string): boolean => /^[A-Z]/.test(name);

function isHookCallee(callee: ESTree.Node): boolean {
	if (callee.type === "Identifier") return HOOK_CALLEE.test(callee.name);
	return (
		callee.type === "MemberExpression" &&
		!callee.computed &&
		callee.property.type === "Identifier" &&
		HOOK_CALLEE.test(callee.property.name)
	);
}

/**
 * Whether `fn` itself calls a hook. A hook called inside a nested callback runs
 * when that callback runs, not during render, so it does not count.
 */
export function callsHook(fn: FunctionNode): boolean {
	const visit = (node: unknown): boolean => {
		if (typeof node !== "object" || node === null) return false;
		if (Array.isArray(node)) return node.some(visit);
		if (!("type" in node) || typeof node.type !== "string") return false;
		const typed = node as ESTree.Node;
		if (typed !== fn && isFunctionNode(typed)) return false;
		if (typed.type === "CallExpression" && isHookCallee(typed.callee)) return true;
		for (const [key, value] of Object.entries(typed)) {
			if (key !== "parent" && visit(value)) return true;
		}
		return false;
	};
	return visit(fn.body);
}

export const OPT_OUT_DIRECTIVES = new Set(["use no memo", "use no forget"]);

export function optsOut(fn: FunctionNode): boolean {
	return (
		fn.body?.type === "BlockStatement" &&
		fn.body.body.some(
			(statement) =>
				statement.type === "ExpressionStatement" &&
				typeof statement.directive === "string" &&
				OPT_OUT_DIRECTIVES.has(statement.directive),
		)
	);
}

/** The name a function is known by: its own, or the variable or `memo(…)` call it initializes. */
export function functionName(fn: FunctionNode): string | undefined {
	if (fn.type !== "ArrowFunctionExpression" && fn.id) return fn.id.name;
	let parent = fn.parent;
	while (
		parent?.type === "CallExpression" &&
		parent.callee.type === "Identifier" &&
		(parent.callee.name === "memo" || parent.callee.name === "forwardRef")
	) {
		parent = parent.parent;
	}
	if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") {
		return parent.id.name;
	}
	return undefined;
}
