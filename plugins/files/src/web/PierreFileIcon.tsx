import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";
import { useInsertionEffect, useMemo } from "react";

import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

const PIERRE_ICON_SPRITE_ID = "pierre-file-icon-sprite";
const iconResolver = createFileTreeIconResolver("complete");

const ICON_COLORS: Record<string, string> = {
	astro: "light-dark(#a631be, #d568ea)",
	babel: "light-dark(#d5a910, #ffd452)",
	bash: "light-dark(#199f43, #5ecc71)",
	biome: "light-dark(#1a85d4, #69b1ff)",
	bootstrap: "light-dark(#693acf, #9d6afb)",
	browserslist: "light-dark(#d5a910, #ffd452)",
	bun: "light-dark(#594c5b, #79697b)",
	c: "light-dark(#1a85d4, #69b1ff)",
	claude: "light-dark(#d47628, #ffa359)",
	cpp: "light-dark(#1a85d4, #69b1ff)",
	css: "light-dark(#693acf, #9d6afb)",
	database: "light-dark(#a631be, #d568ea)",
	default: "light-dark(#84848a, #adadb1)",
	docker: "light-dark(#1a85d4, #69b1ff)",
	eslint: "light-dark(#693acf, #9d6afb)",
	font: "light-dark(#84848a, #adadb1)",
	git: "light-dark(#ff8c5b, #d5512f)",
	go: "light-dark(#1ca1c7, #68cdf2)",
	graphql: "light-dark(#d32a61, #ff678d)",
	html: "light-dark(#d47628, #ffa359)",
	image: "light-dark(#d32a61, #ff678d)",
	javascript: "light-dark(#d5a910, #ffd452)",
	json: "light-dark(#d47628, #ffa359)",
	markdown: "light-dark(#199f43, #5ecc71)",
	mcp: "light-dark(#17a5af, #64d1db)",
	nextjs: "light-dark(#84848a, #adadb1)",
	npm: "light-dark(#d52c36, #ff6762)",
	oxc: "light-dark(#1ca1c7, #68cdf2)",
	postcss: "light-dark(#d52c36, #ff6762)",
	prettier: "light-dark(#17a5af, #64d1db)",
	python: "light-dark(#1a85d4, #69b1ff)",
	react: "light-dark(#1ca1c7, #68cdf2)",
	ruby: "light-dark(#d52c36, #ff6762)",
	rust: "light-dark(#d47628, #ffa359)",
	sass: "light-dark(#d32a61, #ff678d)",
	stylelint: "light-dark(#84848a, #adadb1)",
	svelte: "light-dark(#d52c36, #ff6762)",
	svg: "light-dark(#d47628, #ffa359)",
	svgo: "light-dark(#199f43, #5ecc71)",
	swift: "light-dark(#d47628, #ffa359)",
	table: "light-dark(#17a5af, #64d1db)",
	tailwind: "light-dark(#1ca1c7, #68cdf2)",
	terraform: "light-dark(#693acf, #9d6afb)",
	text: "light-dark(#84848a, #adadb1)",
	typescript: "light-dark(#1a85d4, #69b1ff)",
	vite: "light-dark(#a631be, #d568ea)",
	vscode: "light-dark(#1a85d4, #69b1ff)",
	vue: "light-dark(#199f43, #5ecc71)",
	wasm: "light-dark(#693acf, #9d6afb)",
	webpack: "light-dark(#1a85d4, #69b1ff)",
	yml: "light-dark(#d52c36, #ff6762)",
	zig: "light-dark(#d47628, #ffa359)",
	zip: "light-dark(#d47628, #ffa359)",
};

function ensurePierreIconSprite(): void {
	if (typeof document === "undefined" || document.getElementById(PIERRE_ICON_SPRITE_ID)) return;
	const container = document.createElement("div");
	container.id = PIERRE_ICON_SPRITE_ID;
	container.setAttribute("aria-hidden", "true");
	container.style.position = "absolute";
	container.style.width = "0";
	container.style.height = "0";
	container.style.overflow = "hidden";
	container.style.pointerEvents = "none";
	container.innerHTML = getBuiltInSpriteSheet("complete");
	document.body.prepend(container);
}

export function PierreFileIcon({
	path,
	className,
}: {
	readonly path: string;
	readonly className?: string;
}) {
	useInsertionEffect(ensurePierreIconSprite, []);
	const icon = useMemo(() => iconResolver.resolveIcon("file-tree-icon-file", path), [path]);

	return (
		<svg
			aria-hidden="true"
			className={cn("shrink-0", className)}
			data-icon-token={icon.token}
			data-pierre-file-icon={icon.name}
			style={{ color: ICON_COLORS[icon.token ?? "default"] ?? ICON_COLORS.default }}
			viewBox={icon.viewBox ?? "0 0 16 16"}
		>
			<use href={`#${icon.name}`} />
		</svg>
	);
}
