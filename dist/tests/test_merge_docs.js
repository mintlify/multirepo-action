import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { mergeNavigationAsProducts } from "../src/merge_docs.js";
async function loadJson(p) {
    const text = await readFile(p, "utf-8");
    return JSON.parse(text);
}
async function main() {
    const base = await loadJson("./tests/artifacts/docs_base.json");
    const docs1 = await loadJson("./tests/artifacts/docs1.json");
    const docs2 = await loadJson("./tests/artifacts/docs2.json");
    // Start with products on the base
    let mergedConfig = {
        ...base,
        navigation: { ...(base.navigation || {}), products: [] },
    };
    // Merge docs1 then docs2, preserving order (first merged appears first)
    mergedConfig.navigation = mergeNavigationAsProducts(mergedConfig, docs1, "docs1");
    mergedConfig.navigation = mergeNavigationAsProducts(mergedConfig, docs2, "docs2");
    // Write the resulting full docs.json to tests/artifacts for inspection
    await writeFile("./tests/artifacts/docs_result.json", JSON.stringify(mergedConfig, null, 2), "utf-8");
    // Basic shape assertions
    assert.ok(Array.isArray(mergedConfig.navigation.products), "products should be an array");
    assert.equal(mergedConfig.navigation.products.length, 2, "should have exactly 2 products");
    // Order check
    assert.equal(mergedConfig.navigation.products[0].product, docs1.name);
    assert.equal(mergedConfig.navigation.products[1].product, docs2.name);
    // docs1 and docs2 both use tabs; verify prefix applied within groups/pages
    assert.equal(mergedConfig.navigation.products[0].tabs?.[0].groups?.[0].pages?.[0], "docs1/index", "first product first tab first group first page should be prefixed with docs1/");
    assert.equal(mergedConfig.navigation.products[1].tabs?.[0].groups?.[0].pages?.[0], "docs2/index", "second product first tab first group first page should be prefixed with docs2/");
    // Ensure no unintended mixing: groups/pages shouldn't be set for these inputs
    assert.equal(mergedConfig.navigation.products[0].groups, undefined);
    assert.equal(mergedConfig.navigation.products[0].pages, undefined);
    assert.equal(mergedConfig.navigation.products[1].groups, undefined);
    assert.equal(mergedConfig.navigation.products[1].pages, undefined);
    // New behavior: carry over icon/description from the sub docs.json into product entry
    assert.equal(mergedConfig.navigation.products[0].icon, docs1.icon);
    assert.equal(mergedConfig.navigation.products[0].description, docs1.description);
    assert.equal(mergedConfig.navigation.products[1].icon, docs2.icon);
    assert.equal(mergedConfig.navigation.products[1].description, undefined);
    // eslint-disable-next-line no-console
    console.log("mergeNavigationAsProducts tests passed.");
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
