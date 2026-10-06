import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCoreTool, getRegisteredPlasticExportNames, toToolName } from "../src/pi/tool-registry";
import { loadRegisteredTools } from "./pi-tool-harness";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const docsRoot = resolve(root, "docs");
const packArg = process.argv.indexOf("--pack-manifest");
const packEntries: Set<string> | null = packArg < 0 ? null : new Set<string>(
    JSON.parse(readFileSync(process.argv[packArg + 1], "utf8"))[0].files.map((entry: { path: string }) => entry.path),
);
const read = (path: string) => readFileSync(path, "utf8");
const stripFences = (text: string) => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
const paths: string[] = [];
function walk(path: string) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
        assert(!entry.isSymbolicLink(), "Documentation must be ordinary packed files");
        const child = resolve(path, entry.name);
        if (entry.isDirectory()) walk(child);
        else if (entry.name.endsWith(".md")) paths.push(child);
    }
}
walk(docsRoot);
assert(paths.length >= 2, "A manual must not collapse back into the root README");
const readmePath = resolve(root, "README.md"), indexPath = resolve(docsRoot, "README.md");
assert(paths.includes(indexPath));
assert(Buffer.byteLength(read(readmePath), "utf8") <= 8192, "Root README should remain a concise landing page");
assert(read(readmePath).includes(`${getRegisteredPlasticExportNames().length} core tools`));

function anchors(path: string): Set<string> {
    const text = stripFences(read(path)), result = new Set<string>();
    const seen = new Map<string, number>();
    for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
        const base = match[1].replace(/<[^>]*>/g, "").toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, "").replace(/ /g, "-");
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        result.add(count ? `${base}-${count}` : base);
    }
    for (const match of text.matchAll(/<a\s+(?:id|name)=["']([^"']+)["']/g)) result.add(match[1]);
    return result;
}
function packed(path: string) {
    const rel = relative(root, path).replaceAll("\\", "/");
    if (packEntries && !packEntries.has(rel)) return false;
    return manifest.files.some((entry: string) => {
        const normalized = entry.replace(/\/$/, "");
        return rel === normalized || rel.startsWith(normalized + "/");
    });
}
let links = 0;
function checkLink(from: string, href: string) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return;
    const [rawPath, fragment] = href.split("#");
    const decoded = decodeURIComponent(rawPath);
    assert(!isAbsolute(decoded), `Use package-relative or public URLs: ${href}`);
    const target = decoded ? resolve(dirname(from), decoded) : from;
    const rel = relative(root, target);
    assert(!rel.startsWith("..") && !isAbsolute(rel), `Link escapes the owning package: ${href}`);
    assert(existsSync(target) && statSync(target).isFile(), `Broken link in ${relative(root, from)}: ${href}`);
    assert(packed(target), `Installed readers need this link target packed: ${href}`);
    if (fragment) assert(anchors(target).has(decodeURIComponent(fragment)), `Broken anchor in ${relative(root, from)}: ${href}`);
    links++;
}
const skillPath = resolve(root, "skills/using-plastic/SKILL.md");
const publicDocs = [readmePath, ...paths, skillPath];
for (const path of publicDocs) {
    const text = stripFences(read(path));
    assert(packed(path), `Every consumer document must ship: ${relative(root, path)}`);
    let tablePipes: number | null = null;
    for (const line of text.split("\n")) {
        if (!/^\s*\|/.test(line)) { tablePipes = null; continue; }
        const count = [...line.matchAll(/(?<!\\)\|/g)].length;
        if (tablePipes !== null) assert.equal(count, tablePipes, `Unescaped pipe or inconsistent table columns in ${relative(root, path)}: ${line}`);
        tablePipes = count;
    }
    assert.equal([...text.matchAll(/^#\s+\S/gm)].length, 1, `One H1 per page: ${relative(root, path)}`);
    for (const match of text.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) checkLink(path, match[1]);
    if (paths.includes(path)) {
        assert(read(path).includes("[Documentation index](README.md)") || path === indexPath, `Provide a way back: ${relative(root, path)}`);
        const name = relative(docsRoot, path);
        assert(name === "README.md" || /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(name), `Date-prefix topic pages: ${name}`);
        assert(Buffer.byteLength(read(path), "utf8") <= 16384, `Split oversized topics instead of recreating the README: ${name}`);
    }
}

const names = getRegisteredPlasticExportNames(), tools = await loadRegisteredTools();
assert.equal([...tools.values()].filter(tool => tool.outputSchema).length, names.length);
assert(!tools.get("plastic_tool_search")!.outputSchema);
const routes = new Map<string, string>();
for (const match of read(indexPath).matchAll(/\|\s*`(plastic_[A-Za-z_]+)`\s*\|\s*\[[^\]]+\]\(([^)]+)\)\s*\|/g)) {
    assert(!routes.has(match[1]), `Duplicate index route: ${match[1]}`);
    routes.set(match[1], match[2]);
    checkLink(indexPath, match[2]);
}
assert.deepEqual([...routes.keys()].sort(), ["plastic_tool_search", ...names.map(toToolName)].sort(), "Index every core tool plus loader exactly once");

// Check example names/parameter keys without evaluating Markdown or executing tools.
let examples = 0;
function checkArguments(name: string, keys: string[]) {
    assert(tools.has(name), `Example names an unregistered tool: ${name}`);
    const exportName = names.find(value => toToolName(value) === name);
    const allowed = exportName ? Object.keys(getCoreTool(exportName).args ?? {}) : ["query", "toolNames", "limit"];
    for (const key of keys) assert(allowed.includes(key), `Example uses undeclared ${name} parameter: ${key}`);
    examples++;
}
for (const path of [readmePath, ...paths]) {
    const text = read(path);
    for (const block of text.matchAll(/^```text\s*\n([\s\S]*?)^```/gm)) {
        for (const match of block[1].matchAll(/^\s*(plastic_\w+)\((.*)\)\s*$/gm)) {
            checkArguments(match[1], [...match[2].matchAll(/(?:^|,)\s*([A-Za-z]\w*)\s*=/g)].map(m => m[1]));
        }
    }
    for (const match of text.matchAll(/tools\.(plastic_\w+)\(\{([^}]*)\}\)/g)) {
        checkArguments(match[1], [...match[2].matchAll(/(?:^|,)\s*([A-Za-z]\w*)\s*:/g)].map(m => m[1]));
    }
    assert(!/other adapters remain generic|is the (?:fifth|sixth|seventh|ninth|tenth|eleventh|twelfth) schema-bearing tool/i.test(text), "Consumer docs must not preserve obsolete rollout milestones");
}
assert(examples > 0);
const dev = paths.find(path => path.endsWith("-development.md"))!;
for (const packageName of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
    assert(read(dev).includes(`**${manifest.devDependencies[packageName]}**`), `Keep documented validation baseline aligned: ${packageName}`);
}
assert(read(skillPath).includes("../../docs/README.md"), "Route agents into same-package docs progressively");
console.log(`PASS: concise README, ${paths.length} dated/index manual pages, ${routes.size} tool routes, ${links} local links/anchors/packed targets, ${examples} example calls and current schemas/runtime baseline; no tool execution or network`);
