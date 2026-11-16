/** Identity of a renderer window, passed from main through the preload. */
export interface RendererWindow {
	readonly id: string;
	readonly role: "main" | "secondary";
	/** For secondary windows: the `kernel/window-view` contribution to render. */
	readonly view?: string;
	readonly params: Readonly<Record<string, string>>;
}
