/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare const RELEASE_TRACK: "preview" | "stable";
/** The Kilo server line this build ships (packages/bundled-plugins/src/server-line.ts). */
declare const KILO_SERVER_LINE: "v1" | "v2";
declare const UPDATE_PUBLISH_URLS: Readonly<Record<"preview" | "stable", string>>;
