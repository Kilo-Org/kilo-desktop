// Process-agnostic kernel API: definitions, registries, the core runtime and
// the kernel's own extension points and domain objects.
export * from "./bridge";
export * from "./builtins";
export * from "./commands";
export * from "./discovery";
export * from "./disposables";
export * from "./dnd";
export * from "./domain-object";
export * from "./domain-object-registry";
export * from "./errors";
export * from "./extension-point";
export * from "./extension-registry";
export * from "./host-services";
export * from "./ids";
export * from "./kernel";
export * from "./keybindings";
export * from "./manifest";
export * from "./object-type";
export * from "./permissions";
export * from "./plugin";
export * from "./sdk";
export * from "./transport";
export * from "./when";
export * from "./window";
export {
	adaptPort,
	wrapMessagePort,
	type KernelPort,
	type PortCaller,
	type PortHandler,
	type RawPort,
} from "./ports";
