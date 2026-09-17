declare global {
	interface HTMLWebViewElement extends HTMLElement {
		getWebContentsId(): number;
		reload(): void;
	}
}

export type ElectronWebview = HTMLWebViewElement;
