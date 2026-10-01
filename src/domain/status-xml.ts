import { DOMParser, type Element } from "@xmldom/xmldom";
import type { MachineReadableStatusItem, MachineReadableStatusSummary } from "./pending";

import { STATUS_XML_LIMITS } from "../execution/status-xml-limits";
export { STATUS_XML_LIMITS } from "../execution/status-xml-limits";
export type XmlStatusItem = Omit<MachineReadableStatusItem, "revisionId" | "statusCode" | "kind"> & { statusCode: keyof typeof kinds; kind: typeof kinds[keyof typeof kinds] };
export class StatusXmlError extends Error {
    constructor() { super("Status XML did not match the supported observation contract."); }
}
function invalid(): never { throw new StatusXmlError(); }
const kinds = { CH: "changed", AD: "added", DE: "deleted", LD: "deleted", MV: "moved", PR: "private" } as const;
const fields = new Set(["Type", "TypeVerbose", "Path", "OldPath", "PrintableMovedPath", "MergesInfo", "SimilarityPerUnit", "Similarity", "Size", "PrintableSize", "PrintableLastModified", "RevisionType", "LastModified"]);
const isAbsolute = (path: string): boolean => path.startsWith("/") || /^[A-Za-z]:\\/.test(path) || /^\\\\[^\\]+\\[^\\]+\\/.test(path);
const identity = (value: string): string => {
    if (!value || value.length > STATUS_XML_LIMITS.path || !isAbsolute(value) || /[\u0000-\u001f\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value) || (process.platform === "win32" && value.includes("?"))) invalid();
    return value;
};

// Fatal byte decoding distinguishes literal U+FFFD from decoder substitution.
export function decodeStatusXml(bytes: Uint8Array): string {
    if (bytes.byteLength > STATUS_XML_LIMITS.stdoutBytes) invalid();
    let output: string;
    try { output = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return invalid(); }
    // This is a declaration gate, not an XML parser. Only the documented UTF-8 document format is supported.
    if (!/^<\?xml\s+version\s*=\s*(["'])1\.0\1\s+encoding\s*=\s*(["'])utf-8\2(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*\?>/i.test(output)) invalid();
    return output;
}

export function parseStatusXml(bytes: Uint8Array): { output: string; items: XmlStatusItem[]; summary: MachineReadableStatusSummary } {
    const output = decodeStatusXml(bytes);
    // Conservative denial also rejects these tokens in comments/CDATA; no DTD processing is allowed.
    const upper = output.toUpperCase();
    if (upper.includes("<!DOCTYPE") || upper.includes("<!ENTITY")) invalid();
    let document;
    try {
        document = new DOMParser({ locator: false, onError: () => invalid() }).parseFromString(output, "application/xml");
    } catch { return invalid(); }
    if (document.doctype || !document.documentElement || document.documentElement.tagName !== "StatusOutput") invalid();
    const stack: Array<[Element, number]> = [[document.documentElement, 1]];
    let records = 0;
    while (stack.length) {
        const [element, depth] = stack.pop()!;
        if (depth > STATUS_XML_LIMITS.depth || element.attributes.length || element.namespaceURI) invalid();
        if (element.tagName === "Change" && ++records > STATUS_XML_LIMITS.records) invalid();
        const cap = element.tagName === "Path" || element.tagName === "OldPath" ? STATUS_XML_LIMITS.path : element.tagName === "Type" ? STATUS_XML_LIMITS.code : STATUS_XML_LIMITS.text;
        // Accumulated text, including adjacent text/CDATA nodes, is bounded before projection.
        let textLength = 0;
        for (let node = element.firstChild; node; node = node.nextSibling) {
            if (node.nodeType === 1) stack.push([node as Element, depth + 1]);
            else if (node.nodeType === 3 || node.nodeType === 4) textLength += (node.nodeValue ?? "").length;
            else if (node.nodeType !== 8) invalid();
        }
        if (textLength > cap) invalid();
    }
    const children = (element: Element, allowed: ReadonlySet<string>): Map<string, Element> => {
        const result = new Map<string, Element>();
        for (let node = element.firstChild; node; node = node.nextSibling) {
            if (node.nodeType === 1) {
                const child = node as Element;
                if (!allowed.has(child.tagName) || result.has(child.tagName)) invalid();
                result.set(child.tagName, child);
            } else if (node.nodeType !== 8 && (node.nodeValue ?? "").trim()) invalid();
        }
        return result;
    };
    const leaf = (element: Element | undefined): string => {
        if (!element || element.getElementsByTagName("*").length) return invalid();
        return element.textContent ?? "";
    };
    const root = children(document.documentElement, new Set(["WorkspaceStatus", "WkConfigType", "WkConfigName", "Changes"]));
    // A well-formed but foreign/underspecified document must never become complete-empty status.
    const workspace = root.get("WorkspaceStatus");
    if (!workspace || !leaf(root.get("WkConfigType")) || !leaf(root.get("WkConfigName"))) invalid();
    const status = children(workspace, new Set(["Status"])).get("Status");
    if (!status) invalid();
    const context = children(status, new Set(["RepSpec", "Changeset"]));
    if (!/^\d+$/.test(leaf(context.get("Changeset")))) invalid();
    const rep = context.get("RepSpec");
    if (!rep) invalid();
    const spec = children(rep, new Set(["Server", "Name"]));
    if (!leaf(spec.get("Server")) || !leaf(spec.get("Name"))) invalid();
    const items: XmlStatusItem[] = [];
    const seen = new Set<string>();
    const changes = root.get("Changes");
    if (changes) for (let node = changes.firstChild; node; node = node.nextSibling) {
        if (node.nodeType !== 1) { if (node.nodeType !== 8 && (node.nodeValue ?? "").trim()) invalid(); continue; }
        const change = node as Element;
        if (change.tagName !== "Change") invalid();
        const row = children(change, fields);
        // All recognized fields are scalar in the verified configuration.
        for (const value of row.values()) leaf(value);
        const statusCode = leaf(row.get("Type"));
        if (!Object.hasOwn(kinds, statusCode)) invalid();
        const kind = kinds[statusCode as keyof typeof kinds];
        const path = identity(leaf(row.get("Path")));
        const oldPath = leaf(row.get("OldPath"));
        const revisionType = leaf(row.get("RevisionType"));
        if (revisionType !== "enDirectory" && revisionType !== "enTextFile") invalid();
        if ((kind === "moved") !== Boolean(oldPath)) invalid();
        if (oldPath && identity(oldPath) === path) invalid();
        if (seen.has(path)) invalid();
        seen.add(path);
        items.push({ statusCode: statusCode as keyof typeof kinds, kind, path, isDirectory: revisionType === "enDirectory", ...(oldPath ? { sourcePath: oldPath } : {}) });
    }
    const summary: MachineReadableStatusSummary = { totalPending: items.length, added: 0, changed: 0, moved: 0, deleted: 0, private: 0, other: 0, tracked: 0 };
    for (const row of items) summary[row.kind]++;
    summary.tracked = items.length - summary.private;
    return { output, items, summary };
}
