const prependPrefix = (group, prefix) => {
    return {
        ...group,
        pages: group.pages.map((entry) => typeof entry === "string"
            ? `${prefix}/${entry}`
            : prependPrefix(entry, prefix)),
    };
};
/**
 * Merge a sub repo's top-level navigation (tabs | groups | pages) into the main
 * navigation as a new product entry at the end of the products list.
 *
 * Inputs/outputs mirror the style of mergeDocsNavigation in src/index.ts:
 * - does not mutate inputs
 * - returns a new navigation object
 *
 * The caller should pass the sub repo's docs name as productName.
 */
export const mergeNavigationAsProducts = (main, sub, prefix) => {
    // Determine which top-level structure the sub repo uses: tabs, groups, or pages
    const hasTabs = Array.isArray(sub.navigation?.tabs) &&
        (sub.navigation.tabs?.length ?? 0) > 0;
    const hasGroups = Array.isArray(sub.navigation?.groups) &&
        (sub.navigation.groups?.length ?? 0) > 0;
    const hasPages = Array.isArray(sub.navigation?.pages) &&
        (sub.navigation.pages?.length ?? 0) > 0;
    // If nothing recognizable is present, return main unchanged (but ensure products exists)
    if (!hasTabs && !hasGroups && !hasPages) {
        return {
            ...main,
            navigation: {
                ...(main.navigation || {}),
                products: [...(main.navigation?.products || [])],
            },
        };
    }
    const productEntry = {
        product: sub.name,
    };
    if (hasTabs) {
        productEntry.tabs = sub.navigation.tabs.map((t) => ({
            ...t,
            pages: t.pages
                ? t.pages.map((entry) => typeof entry === "string"
                    ? `${prefix}/${entry}`
                    : prependPrefix(entry, prefix))
                : undefined,
            groups: t.groups
                ? t.groups.map((g) => prependPrefix(g, prefix))
                : undefined,
        }));
    }
    else if (hasGroups) {
        productEntry.groups = sub.navigation.groups.map((g) => prependPrefix(g, prefix));
    }
    else if (hasPages) {
        productEntry.pages = sub.navigation.pages.map((p) => `${prefix}/${p}`);
    }
    return {
        ...main,
        navigation: {
            ...(main.navigation || {}),
            products: [...(main.navigation?.products || []), productEntry],
        },
    };
};
