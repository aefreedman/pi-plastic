import { commentGuid } from "./review-comments";
import { reviewXmlDate, reviewXmlRoot, reviewXmlElements, reviewXmlFields } from "./review-xml";
export type ReviewCommentRow = {
    guid: string; id: string; reviewId: string; type: string; text: string; line: number | null; location: string;
    revisionId: string; changeset: string; parentId: string; owner: string; date: string; appliedInChangeset: string;
    itemId: string; lastRepositoryPath: string; modifiedDate: string; serverPath: null;
};
const fields = ["ID", "OWNER", "DATE", "COMMENT", "REVISIONID", "REVIEWID", "LOCATION", "LINE", "TYPE", "PARENT", "CHANGESET", "APPLIEDINCHANGESET", "GUID", "ITEMID", "PATH", "MODIFIEDDATE"];
/** CM 11.0.16.10616 XML profile. PATH is last repository path, NOT review/workspace identity. */
export function parseReviewCommentsXml(xml: string, review: string): ReviewCommentRow[] {
    if (!/^[1-9][0-9]{0,19}$/.test(review)) throw Error("unsupported_profile");
    const records = reviewXmlElements(reviewXmlRoot(xml, "PLASTICQUERY"));
    if (records.length > 500) throw Error("unsupported_profile");
    const rows = records.map(record => {
        if (record.tagName !== "CHANGEREVIEWCOMMENT") throw Error("unsupported_profile");
        const v = reviewXmlFields(record, fields);
        if (!commentGuid(v.GUID) || !/^[1-9][0-9]{0,19}$/.test(v.ID) || v.REVIEWID !== review || !["conversation", "timeline", "change", "question", "comment", "script", "discarded"].includes(v.TYPE) || ["REVISIONID", "LOCATION", "PARENT", "CHANGESET", "APPLIEDINCHANGESET"].some(k => !/^(?:-1|0|[1-9][0-9]{0,19})$/.test(v[k]))) throw Error("unsupported_profile");
        if (!reviewXmlDate(v.DATE) || !reviewXmlDate(v.MODIFIEDDATE) || !/^(?:|[1-9][0-9]{0,19})$/.test(v.ITEMID) || v.PATH !== "" && (!v.PATH.startsWith("/") || v.ITEMID === "") || v.REVISIONID === "-1" && (v.ITEMID !== "" || v.PATH !== "")) throw Error("unsupported_profile");
        const line = v.LINE === "" ? null : Number(v.LINE);
        if (line === null ? v.LOCATION !== "-1" : !/^[1-9][0-9]*$/.test(v.LINE) || !Number.isSafeInteger(line) || String(line - 1) !== v.LOCATION) throw Error("unsupported_profile");
        return { guid: v.GUID, id: v.ID, reviewId: v.REVIEWID, type: v.TYPE, text: v.COMMENT, line, location: v.LOCATION, revisionId: v.REVISIONID, changeset: v.CHANGESET, parentId: v.PARENT, owner: v.OWNER, date: v.DATE, appliedInChangeset: v.APPLIEDINCHANGESET, itemId: v.ITEMID, lastRepositoryPath: v.PATH, modifiedDate: v.MODIFIEDDATE, serverPath: null };
    });
    if (new Set(rows.map(r => r.guid.toLowerCase())).size !== rows.length || new Set(rows.map(r => r.id)).size !== rows.length) throw Error("malformed_output");
    return rows;
}
