import {
	BrowserWindow,
	clipboard,
	Menu,
	type ContextMenuParams,
	type MenuItemConstructorOptions,
	type WebContents,
} from "electron";

/**
 * Electron shows no context menu by default, so every WebContents that renders
 * app or web content must opt in. The menu mirrors a browser's: spelling fixes,
 * edit actions for fields, Copy for selections, Copy Link for links, plus
 * Inspect Element in development. Components with their own right-click menu
 * call `preventDefault()` on `contextmenu`, which suppresses this event.
 */
export function attachContextMenu(
	contents: WebContents,
	options: { readonly isDevelopment: boolean },
): () => void {
	const actions: ContextMenuActions = {
		replaceMisspelling: (suggestion) => contents.replaceMisspelling(suggestion),
		addToDictionary: (word) => contents.session.addWordToSpellCheckerDictionary(word),
		copyLink: (url) => clipboard.writeText(url),
		inspectElement: (x, y) => contents.inspectElement(x, y),
	};
	const showMenu = (_event: Electron.Event, params: ContextMenuParams) => {
		const template = buildContextMenuTemplate(params, { ...options, actions });
		if (template.length === 0) return;
		const window = BrowserWindow.fromWebContents(contents.hostWebContents ?? contents);
		Menu.buildFromTemplate(template).popup({
			...(window ? { window } : {}),
			// Passing the frame enables macOS Writing Tools, AutoFill, and Services.
			...(params.frame ? { frame: params.frame } : {}),
		});
	};
	contents.on("context-menu", showMenu);
	return () => contents.off("context-menu", showMenu);
}

export type ContextMenuTarget = Pick<
	ContextMenuParams,
	| "x"
	| "y"
	| "isEditable"
	| "editFlags"
	| "selectionText"
	| "misspelledWord"
	| "dictionarySuggestions"
	| "linkURL"
>;

export interface ContextMenuActions {
	replaceMisspelling(suggestion: string): void;
	addToDictionary(word: string): void;
	copyLink(url: string): void;
	inspectElement(x: number, y: number): void;
}

export interface ContextMenuTemplateOptions {
	readonly isDevelopment: boolean;
	readonly actions: ContextMenuActions;
}

type MenuGroup = MenuItemConstructorOptions[];

export function buildContextMenuTemplate(
	target: ContextMenuTarget,
	{ isDevelopment, actions }: ContextMenuTemplateOptions,
): MenuItemConstructorOptions[] {
	const groups: MenuGroup[] = [];
	if (target.misspelledWord) groups.push(...spellingGroups(target, actions));
	if (target.isEditable) groups.push(...editGroups(target.editFlags));
	else if (target.selectionText.trim()) groups.push([{ role: "copy" }]);
	if (target.linkURL) {
		groups.push([{ label: "Copy Link", click: () => actions.copyLink(target.linkURL) }]);
	}
	if (isDevelopment) {
		groups.push([
			{ label: "Inspect Element", click: () => actions.inspectElement(target.x, target.y) },
		]);
	}
	return joinGroups(groups);
}

function spellingGroups(target: ContextMenuTarget, actions: ContextMenuActions): MenuGroup[] {
	const suggestions: MenuGroup =
		target.dictionarySuggestions.length > 0
			? target.dictionarySuggestions.map((suggestion) => ({
					label: suggestion,
					click: () => actions.replaceMisspelling(suggestion),
				}))
			: [{ label: "No Guesses Found", enabled: false }];
	return [
		suggestions,
		[
			{
				label: "Add to Dictionary",
				click: () => actions.addToDictionary(target.misspelledWord),
			},
		],
	];
}

function editGroups(flags: ContextMenuTarget["editFlags"]): MenuGroup[] {
	return [
		[
			{ role: "undo", enabled: flags.canUndo },
			{ role: "redo", enabled: flags.canRedo },
		],
		[
			{ role: "cut", enabled: flags.canCut },
			{ role: "copy", enabled: flags.canCopy },
			{ role: "paste", enabled: flags.canPaste },
		],
		[{ role: "selectAll", enabled: flags.canSelectAll }],
	];
}

function joinGroups(groups: readonly MenuGroup[]): MenuItemConstructorOptions[] {
	return groups
		.filter((group) => group.length > 0)
		.flatMap((group, index) => (index === 0 ? group : [{ type: "separator" as const }, ...group]));
}
