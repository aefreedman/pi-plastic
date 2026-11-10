import { DOMParser, type Element } from "@xmldom/xmldom";

export function validReviewXmlText(value: string): boolean {
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}

/** Strict bounded current-client XML. No DTD, attributes, mixed content or extensions. */
export function reviewXmlRoot(xml: string, name: string, maxBytes = 65536): Element {
    if (Buffer.byteLength(xml, "utf8") > maxBytes || /<!DOCTYPE|<!ENTITY/i.test(xml) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(xml) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(xml)) throw Error("unsupported_profile");
    const doc = new DOMParser({ onError: () => { throw Error("malformed_output"); } }).parseFromString(xml, "application/xml");
    const root = doc.documentElement;
    if (!root || root.tagName !== name || root.attributes.length) throw Error("unsupported_profile");
    for (const n of Array.from(doc.childNodes)) if (n !== root && !(n.nodeType === 7 && n.nodeName === "xml") && !(n.nodeType === 3 && /^\s*$/.test(n.nodeValue ?? ""))) throw Error("malformed_output");
    return root;
}
export function reviewXmlElements(node: Element): Element[] {
    if (node.attributes.length) throw Error("unsupported_profile");
    return Array.from(node.childNodes).filter(n => {
        if (n.nodeType === 3 && /^\s*$/.test(n.nodeValue ?? "")) return false;
        if (n.nodeType !== 1) throw Error("malformed_output");
        return true;
    }) as Element[];
}
export function reviewXmlFields(node: Element, names: readonly string[]): Record<string, string> {
    const children = reviewXmlElements(node), values: Record<string, string> = {};
    if (children.length !== names.length) throw Error("unsupported_profile");
    for (const c of children) {
        if (!names.includes(c.tagName) || Object.hasOwn(values, c.tagName) || c.attributes.length || Array.from(c.childNodes).some(n => n.nodeType !== 3)) throw Error("unsupported_profile");
        const value = c.textContent ?? "";
        if (!validReviewXmlText(value)) throw Error("malformed_output");
        values[c.tagName] = value;
    }
    return values;
}
export const reviewXmlDate = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s));
export type ReviewMembership = { user: string; status: "Under review" | "Reviewed" | "Rework required"; type: "user" | "group" };
export function parseReviewersXml(xml: string): ReviewMembership[] {
    const records = reviewXmlElements(reviewXmlRoot(xml, "Reviewers"));
    if (records.length > 500) throw Error("unsupported_profile");
    return records.map(record => {
        if (record.tagName !== "Reviewer") throw Error("unsupported_profile");
        const v = reviewXmlFields(record, ["User", "Status", "Type"]);
        if (!v.User || v.User.length > 4096 || !["Under review", "Reviewed", "Rework required"].includes(v.Status) || !["user", "group"].includes(v.Type)) throw Error("unsupported_profile");
        return { user: v.User, status: v.Status as ReviewMembership["status"], type: v.Type as ReviewMembership["type"] };
    });
}
