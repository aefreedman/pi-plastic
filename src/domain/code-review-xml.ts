import { commentGuid } from "./review-comments";
import { reviewXmlRoot, reviewXmlElements, reviewXmlFields, reviewXmlDate } from "./review-xml";
export const REVIEW_XML_FIELDS = ["ID", "OWNER", "DATE", "TITLE", "MERGEREQUESTSTATUS", "STATUS", "CODEREVIEWSTATUS", "ASSIGNEE", "TARGETTYPE", "TARGET", "DESTINATION", "GUID", "REVIEWERS", "MODIFIEDDATE", "COMMENTS", "UNRESOLVEDISSUES", "UNRESOLVEDCHANGES", "UNANSWEREDQUESTIONS", "CODEREVIEWSTATUSNAME", "MERGEREQUESTSTATUSNAME"] as const;
export type CodeReviewXmlRow = {
    id: string; guid: string; owner: string; date: string; title: string; assignee: string; targetType: string; target: string; destination: string;
    reviewersRaw: string; modifiedDate: string; comments: number; unresolvedIssues: number; unresolvedChanges: number; unansweredQuestions: number;
    codeReviewStatusName: "Under review" | "Reviewed" | "Rework required"; mergeRequestStatusName: "None" | "Draft" | "Closed" | "Open" | "Merged";
};
/** REVIEWERS is ambiguous native user:status text, retained verbatim, NEVER split. */
export function parseCodeReviewsXml(xml: string): CodeReviewXmlRow[] {
    const records = reviewXmlElements(reviewXmlRoot(xml, "PLASTICQUERY", 1048576));
    if (records.length > 20000) throw Error("unsupported_profile");
    const rows = records.map(record => {
        if (record.tagName !== "REVIEW") throw Error("unsupported_profile");
        const v = reviewXmlFields(record, REVIEW_XML_FIELDS);
        if (!/^[1-9][0-9]{0,19}$/.test(v.ID) || !commentGuid(v.GUID) || !reviewXmlDate(v.DATE) || !reviewXmlDate(v.MODIFIEDDATE) || !["Branch", "Changeset"].includes(v.TARGETTYPE) || !["Under review", "Reviewed", "Rework required"].includes(v.CODEREVIEWSTATUSNAME) || !["None", "Draft", "Closed", "Open", "Merged"].includes(v.MERGEREQUESTSTATUSNAME)) throw Error("unsupported_profile");
        const count = (key: string) => {
            const n = Number(v[key]);
            if (!/^(?:0|[1-9][0-9]*)$/.test(v[key]) || !Number.isSafeInteger(n)) throw Error("unsupported_profile");
            return n;
        };
        return { id: v.ID, guid: v.GUID, owner: v.OWNER, date: v.DATE, title: v.TITLE, assignee: v.ASSIGNEE, targetType: v.TARGETTYPE, target: v.TARGET, destination: v.DESTINATION, reviewersRaw: v.REVIEWERS, modifiedDate: v.MODIFIEDDATE, comments: count("COMMENTS"), unresolvedIssues: count("UNRESOLVEDISSUES"), unresolvedChanges: count("UNRESOLVEDCHANGES"), unansweredQuestions: count("UNANSWEREDQUESTIONS"), codeReviewStatusName: v.CODEREVIEWSTATUSNAME as CodeReviewXmlRow["codeReviewStatusName"], mergeRequestStatusName: v.MERGEREQUESTSTATUSNAME as CodeReviewXmlRow["mergeRequestStatusName"] };
    });
    if (new Set(rows.map(r => r.id)).size !== rows.length || new Set(rows.map(r => r.guid.toLowerCase())).size !== rows.length) throw Error("unsupported_profile");
    return rows;
}
