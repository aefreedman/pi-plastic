import { DOMParser } from "@xmldom/xmldom";
import { commentGuid } from "./review-comments";
export type ReviewCommentRow = { guid: string; id: string; reviewId: string; type: string; text: string; line: number | null; location: string; revisionId: string; changeset: string; parentId: string; serverPath: null };
const fields = ["ID", "OWNER", "DATE", "COMMENT", "REVISIONID", "REVIEWID", "LOCATION", "LINE", "TYPE", "PARENT", "CHANGESET", "APPLIEDINCHANGESET", "GUID"];
/** CM 11.0.16.10512 XML profile. XML newline/entity decoding is explicit; raw capture is retained separately. */
export function parseReviewCommentsXml(xml: string, review: string): ReviewCommentRow[] {
    if (Buffer.byteLength(xml, "utf8") > 65536 || /<!DOCTYPE|<!ENTITY/i.test(xml) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(xml) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(xml) || !/^[1-9][0-9]{0,19}$/.test(review)) throw Error("unsupported_profile");
    const doc = new DOMParser({ onError: () => { throw Error("malformed_output"); } }).parseFromString(xml, "application/xml");
    const root = doc.documentElement;
    if (!root || root.tagName !== "PLASTICQUERY" || root.attributes.length) throw Error("malformed_output");
    const elements = (node: typeof root) => Array.from(node.childNodes).filter(n => { if (n.nodeType === 3 && /^\s*$/.test(n.nodeValue ?? "")) return false; if (n.nodeType !== 1) throw Error("malformed_output"); return true; }) as typeof root[];
    for (const n of Array.from(doc.childNodes)) if (n !== root && !(n.nodeType === 7 && n.nodeName === "xml") && !(n.nodeType === 3 && /^\s*$/.test(n.nodeValue ?? ""))) throw Error("malformed_output");
    const rows = elements(root).map(record => {
        if (record.tagName !== "CHANGEREVIEWCOMMENT" || record.attributes.length) throw Error("malformed_output");
        const children = elements(record), values: Record<string, string> = {};
        if (children.length !== fields.length) throw Error("unsupported_profile");
        for (const c of children) {
            if (!fields.includes(c.tagName) || Object.hasOwn(values, c.tagName) || c.attributes.length || Array.from(c.childNodes).some(n => n.nodeType !== 3)) throw Error("malformed_output");
            values[c.tagName] = c.textContent ?? "";
            if (Array.from(values[c.tagName]).some(ch => { const n = ch.codePointAt(0)!; return n < 32 && ![9, 10, 13].includes(n) || n >= 0xd800 && n <= 0xdfff || n === 0xfffe || n === 0xffff; })) throw Error("malformed_output");
        }
        const v = values;
        if (!commentGuid(v.GUID) || !/^[1-9][0-9]{0,19}$/.test(v.ID) || v.REVIEWID !== review || !["conversation", "timeline", "change", "question", "comment"].includes(v.TYPE) || ["REVISIONID", "LOCATION", "PARENT", "CHANGESET", "APPLIEDINCHANGESET"].some(k => !/^(?:-1|0|[1-9][0-9]{0,19})$/.test(v[k]))) throw Error("unsupported_profile");
        const line = v.LINE === "" ? null : Number(v.LINE);
        if (line === null ? v.LOCATION !== "-1" : !/^[1-9][0-9]*$/.test(v.LINE) || !Number.isSafeInteger(line) || String(line - 1) !== v.LOCATION) throw Error("unsupported_profile");
        return { guid: v.GUID, id: v.ID, reviewId: v.REVIEWID, type: v.TYPE, text: v.COMMENT, line, location: v.LOCATION, revisionId: v.REVISIONID, changeset: v.CHANGESET, parentId: v.PARENT, serverPath: null };
    });
    if (rows.length > 500 || new Set(rows.map(r => r.guid.toLowerCase())).size !== rows.length || new Set(rows.map(r => r.id)).size !== rows.length) throw Error("malformed_output");
    return rows;
}
