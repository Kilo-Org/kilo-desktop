import { TerminalFrameController } from "./TerminalFrameController.js";
import "./styles.css";

const ALLOWED_PARENT_PROTOCOLS = new Set(["kilo-desktop:", "kilo-desktop-dev:"]);

function trustedParentOriginFrom(href: string): string {
	const parentOrigin = new URL(href).searchParams.get("parentOrigin");
	const parentUrl = parentOrigin ? new URL(parentOrigin) : null;
	if (
		!parentUrl ||
		!ALLOWED_PARENT_PROTOCOLS.has(parentUrl.protocol) ||
		parentUrl.host !== "app" ||
		`${parentUrl.protocol}//${parentUrl.host}` !== parentOrigin
	) {
		throw new Error("The terminal frame requires its trusted desktop parent origin.");
	}
	return parentOrigin;
}

function requiredElement(id: string): HTMLElement {
	const element = document.getElementById(id);
	if (!element) throw new Error(`Missing terminal element: ${id}`);
	return element;
}

function requiredButton(id: string): HTMLButtonElement {
	const element = requiredElement(id);
	if (!(element instanceof HTMLButtonElement))
		throw new Error(`Terminal element is not a button: ${id}`);
	return element;
}

new TerminalFrameController({
	hostWindow: window,
	documentElement: document.documentElement,
	trustedParentOrigin: trustedParentOriginFrom(window.location.href),
	elements: {
		container: requiredElement("terminal"),
		scrollbar: requiredElement("terminal-scrollbar"),
		scrollbarThumb: requiredElement("terminal-scrollbar-thumb"),
		terminalState: requiredElement("terminal-state"),
		status: requiredElement("status"),
		error: requiredElement("error"),
		accessibleOutput: requiredElement("accessible-output"),
		restartButton: requiredButton("restart"),
	},
}).start();
