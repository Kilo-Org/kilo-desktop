import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

RuleTester.describe = describe;
RuleTester.it = it;

/** A RuleTester that parses every case as TSX, the language of the renderer. */
export const ruleTester = new RuleTester({
	languageOptions: { sourceType: "module", parserOptions: { lang: "tsx" } },
});
