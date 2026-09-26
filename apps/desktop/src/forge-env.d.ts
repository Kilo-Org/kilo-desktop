/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare const RELEASE_TRACK: "preview" | "stable";
declare const UPDATE_PUBLISH_URLS: Readonly<Record<"preview" | "stable", string>>;
declare const __ENVIRONMENTS_PLUGIN_ROOT__: string;
