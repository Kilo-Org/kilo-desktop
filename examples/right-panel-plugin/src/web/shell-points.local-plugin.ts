// kilo.shell's extension points as a local plugin references them: by id, since
// the kernel matches points by id. Bundling kilo.shell's contracts instead
// would pull in modules the app doesn't share with local plugins.
export const RightSidebarPanel = { id: "kilo.shell/right-sidebar-panel" } as const;
