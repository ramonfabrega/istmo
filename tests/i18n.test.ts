import { expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import spanish from "../src/es.json";
import { chooseLocale, translate } from "../src/i18n";
it("uses a saved choice or the first supported device language", () => {
  expect(chooseLocale("en", ["es-PA"])).toBe("en");
  expect(chooseLocale(null, ["es-PA", "en-US"])).toBe("es");
  expect(chooseLocale("bad", ["fr", "es-MX"])).toBe("es");
  expect(chooseLocale(null, ["fr"])).toBe("en");
});
it("preserves report content and interpolated names without treating them as markup", () => {
  expect(translate("Ground in motion.", "es")).toBe("La tierra en movimiento.");
  expect(translate("Join {name}?", "es", { name: "Abuela <3" })).toBe(
    "¿Unirte a Abuela <3?",
  );
  expect(translate("10 km S of Panama", "es")).toBe("10 km S of Panama");
});
it("provides Spanish for every literal translation call with matching placeholders", () => {
  const missing = new Set<string>();
  for (const file of readdirSync("src").filter((name) =>
    /\.tsx?$/.test(name),
  )) {
    const source = ts.createSourceFile(
      file,
      readFileSync(`src/${file}`, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "t" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const key = node.arguments[0].text;
        if (!(key in spanish)) missing.add(key);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect([...missing]).toEqual([]);
  const tokens = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [english, spanishText] of Object.entries(spanish))
    expect(tokens(spanishText), english).toEqual(tokens(english));
});
