import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import { writeFile, readFile } from "fs/promises";
import { parse } from "yaml";
import type {
  MintConfig,
  Navigation,
  NavigationGroup,
  NavigationEntry,
} from "@mintlify/models";

// DocsConfig type for new docs.json structure
type DocsNavigation = {
  global?: string[];
  languages?: Array<{
    language: string;
    href: string;
    pages?: NavigationEntry[];
    groups?: NavigationGroup[];
  }>;
  versions?: Array<{
    version: string;
    href: string;
    pages?: NavigationEntry[];
    groups?: NavigationGroup[];
  }>;
  tabs?: Array<{
    tab: string;
    pages?: NavigationEntry[];
    groups?: NavigationGroup[];
  }>;
  dropdowns?: Array<{
    dropdown: string;
    pages?: NavigationEntry[];
    groups?: NavigationGroup[];
  }>;
  anchors?: Array<{
    anchor: string;
    pages?: NavigationEntry[];
    groups?: NavigationGroup[];
  }>;
  products?: Array<{
    product: string;
    tabs?: DocsNavigation["tabs"];
    groups?: DocsNavigation["groups"];
    pages?: DocsNavigation["pages"];
  }>;
  groups?: NavigationGroup[];
  pages?: string[];
};

type DocsConfig = {
  theme: "mint" | "maple" | "palm" | "willow" | "linden" | "almond" | "aspen";
  name: string;
  colors: { primary: string; [key: string]: string };
  navigation: DocsNavigation;
  [key: string]: any;
};
import path from "path";

type Repo = {
  owner: string;
  repo: string;
  ref?: string;
  subdirectory?: string;
};

const execOrThrow: (
  ...args: Parameters<typeof exec.exec>
) => Promise<void> = async (...args) => {
  const exitCode = await exec.exec(...args);
  if (exitCode !== 0)
    throw Error(
      `error running command: ${args[0]} ${args[1]?.join(" ") ?? ""}`
    );
};

const setToken = async (token: string) => {
  const encodedToken = Buffer.from(`x-access-token:${token}`, "utf-8").toString(
    "base64"
  );
  core.setSecret(encodedToken);
  const headerPlaceholder = "Authorization: basic ***";
  const headerValue = `Authorization: basic ${encodedToken}`;
  const headerKey = "http.https://github.com/.extraheader";
  const configPath = ".git/config";

  await execOrThrow("git", ["config", "--local", headerKey, headerPlaceholder]);
  const configString = await readFile(configPath, "utf-8");
  await writeFile(
    configPath,
    configString.replace(headerPlaceholder, headerValue)
  );

  return () =>
    execOrThrow("git", ["config", "--local", "--unset-all", headerKey]);
};

const prependPrefix = (
  group: NavigationGroup,
  prefix: string
): NavigationGroup => {
  return {
    ...group,
    pages: group.pages.map((entry) =>
      typeof entry === "string"
        ? `${prefix}/${entry}`
        : prependPrefix(entry, prefix)
    ),
  };
};

/**
 * Merge a sub repo's top-level navigation (tabs | groups | pages) into the main
 * navigation as a new product entry at the end of the products list.
 *
 * - does not mutate inputs
 * - returns a new navigation object
 *
 * The caller should pass the sub repo's docs name as productName.
 */
export const mergeNavigationAsProducts = (
  main: DocsConfig,
  sub: DocsConfig,
  prefix: string
): DocsNavigation => {
  // Determine which top-level structure the sub repo uses: tabs, groups, or pages
  const hasTabs =
    Array.isArray(sub.navigation?.tabs) &&
    (sub.navigation.tabs?.length ?? 0) > 0;
  const hasGroups =
    Array.isArray(sub.navigation?.groups) &&
    (sub.navigation.groups?.length ?? 0) > 0;
  const hasPages =
    Array.isArray(sub.navigation?.pages) &&
    (sub.navigation.pages?.length ?? 0) > 0;

  core.info(
    `[mergeProducts] repo="${prefix}" product="${sub.name}" hasTabs=${hasTabs} hasGroups=${hasGroups} hasPages=${hasPages}`
  );

  // If nothing recognizable is present, return main unchanged (but ensure products exists)
  if (!hasTabs && !hasGroups && !hasPages) {
    core.info(
      `[mergeProducts] Skipping merge for repo="${prefix}" (no tabs/groups/pages found)`
    );
    return {
      ...(main.navigation || {}),
      products: [...(main.navigation?.products || [])],
    };
  }

  const productEntry: NonNullable<DocsNavigation["products"]>[number] = {
    product: sub.name,
  };

  if (hasTabs) {
    productEntry.tabs = sub.navigation.tabs!.map((t) => ({
      ...t,
      pages: t.pages
        ? t.pages.map((entry) =>
            typeof entry === "string"
              ? `${prefix}/${entry}`
              : prependPrefix(entry, prefix)
          )
        : undefined,
      groups: t.groups
        ? t.groups.map((g) => prependPrefix(g, prefix))
        : undefined,
    }));
  } else if (hasGroups) {
    productEntry.groups = sub.navigation.groups!.map((g) =>
      prependPrefix(g, prefix)
    );
  } else if (hasPages) {
    productEntry.pages = sub.navigation.pages!.map((p) => `${prefix}/${p}`);
  }

  const merged: DocsNavigation = {
    ...(main.navigation || {}),
    products: [...(main.navigation?.products || []), productEntry],
  };
  core.info(
    `[mergeProducts] After merge for repo="${prefix}", products.length=${
      merged.products?.length ?? 0
    }`
  );
  return merged;
};

const checkoutBranch = async (branch: string) => {
  core.info(`[checkoutBranch] Checking out branch="${branch}"`); //REMOVEME
  try {
    await execOrThrow("git", [
      "ls-remote",
      "--heads",
      "--exit-code",
      "origin",
      branch,
    ]);
    await execOrThrow("git", ["fetch", "-u", "origin", `${branch}:${branch}`]);
    await execOrThrow("git", ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  } catch {
    await execOrThrow("git", ["checkout", "-b", branch]);
  }
};

let resetToken;
try {
  const token = core.getInput("token");
  const repos = parse(core.getInput("repos")) as Repo[];
  const targetBranch = core.getInput("target-branch");
  const subdirectory = core.getInput("subdirectory");
  const force = core.getBooleanInput("force");

  process.chdir(subdirectory);

  await checkoutBranch(targetBranch);

  const mainConfigText = await readFile("docs.json", "utf-8");
  const mainConfig = JSON.parse(mainConfigText) as DocsConfig;

  resetToken = await setToken(token);
  core.info(`[main] about to iterate over repos=${repos.length}`); //REMOVEME
  for (const { owner, repo, ref, subdirectory: subrepoSubdirectory } of repos) {
    await io.rmRF(repo);

    const args = ["clone", "--depth=1"];
    if (ref) args.push("--branch", ref);
    args.push(`https://github.com/${owner}/${repo}`);

    await execOrThrow("git", args);

    if (subrepoSubdirectory) {
      const tempDirName = "temporary-docs-dir";
      await io.mv(path.join(repo, subrepoSubdirectory), tempDirName);
      await io.rmRF(repo);
      await io.mv(tempDirName, repo);
    } else {
      await io.rmRF(`${repo}/.git`);
    }

    const subConfigText = await readFile(path.join(repo, "docs.json"), "utf-8");
    const subConfig = JSON.parse(subConfigText) as DocsConfig;
    core.info(
      `[merge] Merging repo="${repo}" name="${
        subConfig.name
      }" navKeys=${Object.keys(subConfig.navigation ?? {}).join(",")}`
    );
    mainConfig.navigation = mergeNavigationAsProducts(
      mainConfig,
      subConfig,
      repo
    );
    core.info(
      `[merge] Post-merge products.length=${
        mainConfig.navigation.products?.length ?? 0
      }`
    );
  }

  await writeFile("docs.json", JSON.stringify(mainConfig, null, 2));
  await writeFile("docs.txt", JSON.stringify(mainConfig, null, 2));

  await execOrThrow("git", ["add", "."]);
  try {
    (await exec.exec("git", [
      "diff-index",
      "--quiet",
      "--cached",
      "HEAD",
      "--",
    ])) !== 0;
    core.info("No changes detected, skipping...");
  } catch {
    await execOrThrow("git", ["config", "user.name", "Mintie Bot"]);
    await execOrThrow("git", ["config", "user.email", "aws@mintlify.com"]);
    await execOrThrow("git", ["commit", "-m", "update"]);

    const pushArgs = ["push"];
    if (force) pushArgs.push("--force");
    pushArgs.push("origin", targetBranch);
    await execOrThrow("git", pushArgs);
  }
} catch (error) {
  const message =
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : JSON.stringify(error, null, 2);
  core.setFailed(message);
} finally {
  resetToken?.();
}
