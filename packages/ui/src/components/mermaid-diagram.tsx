import { CircleAlertIcon } from "lucide-react";
import { isValidElement, useEffect, useId, useRef, useState, type CSSProperties } from "react";

import { cn } from "../lib/utils.js";
import { Alert, AlertDescription, AlertTitle } from "./alert.js";
import type { MarkdownRendererExtension } from "./markdown-extension.js";
import { Spinner } from "./spinner.js";

const diagramStyle = {
	"--pele-bg": "var(--background)",
	"--pele-fg": "var(--foreground)",
	"--pele-muted": "var(--muted-foreground)",
	"--pele-line": "var(--foreground)",
	"--pele-surface": "var(--muted)",
	"--pele-surface-alt": "var(--secondary)",
	"--pele-border": "var(--border)",
	"--pele-accent": "var(--primary)",
	"--pele-error": "var(--destructive)",
	"--pele-font": "var(--font-sans)",
	"--pele-font-mono": "var(--font-mono)",
	contain: "content",
} as CSSProperties;

export function MermaidDiagram({
	code,
	className,
}: {
	readonly code: string;
	readonly className?: string;
}) {
	const container = useRef<HTMLDivElement>(null);
	const id = useId();
	const [result, setResult] = useState<{ code: string; error?: string } | null>(null);
	const current = result?.code === code ? result : null;

	useEffect(() => {
		const element = container.current;
		if (!element) return;
		let disposed = false;
		let destroy: (() => void) | undefined;
		const onError = (error: unknown) => {
			if (!disposed) {
				setResult({
					code,
					error: error instanceof Error ? error.message : "Unable to render diagram.",
				});
			}
		};

		void import("./mermaid-renderer.js")
			.then(({ mountMermaid }) => {
				if (disposed) return;
				const diagram = mountMermaid(element, code, id, {
					onRender: () => {
						if (!disposed) setResult({ code });
					},
					onError,
				});
				destroy = () => diagram.destroy();
			})
			.catch(onError);

		return () => {
			disposed = true;
			destroy?.();
			element.replaceChildren();
		};
	}, [code, id]);

	return (
		<div
			aria-busy={!current}
			className={cn("min-w-0 overflow-x-auto", className)}
			data-qa-id="mermaid-diagram"
			style={diagramStyle}
		>
			<div
				ref={container}
				role="img"
				aria-label="Mermaid diagram"
				className={cn(
					"relative min-w-0 overflow-hidden [&_svg.pele]:mx-auto [&_svg.pele]:block",
					!current && "invisible",
				)}
				hidden={Boolean(current?.error)}
			/>
			{!current || current.error ? (
				<div className="flex flex-col gap-3">
					{current?.error ? (
						<Alert variant="destructive">
							<CircleAlertIcon aria-hidden="true" />
							<AlertTitle>Could not render this Mermaid diagram</AlertTitle>
							<AlertDescription className="break-words whitespace-pre-wrap">
								{current.error}
							</AlertDescription>
						</Alert>
					) : (
						<div
							aria-live="polite"
							className="text-muted-foreground flex items-center gap-2 text-xs"
							role="status"
						>
							<Spinner aria-hidden="true" />
							Rendering diagram…
						</div>
					)}
					<pre className="text-muted-foreground overflow-x-auto text-sm leading-relaxed">
						{code}
					</pre>
				</div>
			) : null}
		</div>
	);
}

export function createMermaidMarkdownExtension(): MarkdownRendererExtension {
	return {
		decorateComponents: (next) => ({
			...next,
			pre: ({ node, children, ...props }) => {
				if (
					isValidElement<{ className?: string }>(children) &&
					children.props.className?.split(/\s+/u).includes("language-mermaid")
				) {
					return children;
				}
				const Pre = next.pre;
				if (typeof Pre === "function") {
					return (
						<Pre node={node} {...props}>
							{children}
						</Pre>
					);
				}
				return <pre {...props}>{children}</pre>;
			},
			code: ({ node, className, children, ...props }) => {
				if (className?.split(/\s+/u).includes("language-mermaid")) {
					const code = Array.isArray(children) ? children.join("") : String(children);
					return (
						<MermaidDiagram
							className="border-border-subtle bg-muted/30 my-3 rounded-xl border p-3.5"
							code={code}
						/>
					);
				}
				const Code = next.code;
				if (typeof Code === "function") {
					return (
						<Code node={node} className={className} {...props}>
							{children}
						</Code>
					);
				}
				return (
					<code className={className} {...props}>
						{children}
					</code>
				);
			},
		}),
	};
}
