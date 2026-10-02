import type { Element } from "@xmldom/xmldom";
import { parseDiffXml, diffXmlChildren, diffXmlLeaf, DiffBaseXmlError } from "./diff-base-xml";
export type DiffPendingKind="changed"|"added"|"deleted"|"moved"|"private"|"checkedout"|"copied"|"replaced";
export type DiffPendingItem={path:string;sourcePath:string|null;kind:DiffPendingKind;code:string;directory:boolean};
export type DiffPendingSnapshot={items:DiffPendingItem[];repository:string;server:string;changeset:string};
const kinds={CH:"changed",AD:"added",DE:"deleted",LD:"deleted",MV:"moved",LM:"moved",PR:"private",CO:"checkedout","CO+CH":"changed",CP:"copied",RP:"replaced"} as const;
function invalid():never {throw new DiffBaseXmlError();}
const text=(e:Element|undefined)=>diffXmlLeaf(e);
const path=(s:string)=>{if(!s||s.length>4096||!(/^[A-Za-z]:[\\/]/.test(s)||s.startsWith("/"))||/[\u0000-\u001f\u007f-\u009f]/.test(s)||(process.platform==="win32"&&s.includes("?")))invalid();return s;};
export function parseDiffPending(bytes:Uint8Array):DiffPendingSnapshot {
    const root=diffXmlChildren(parseDiffXml(bytes,"StatusOutput"),new Set(["WorkspaceStatus","WkConfigType","WkConfigName","Changes"]));
    if(!text(root.get("WkConfigType"))||!text(root.get("WkConfigName")))invalid();
    const workspace=root.get("WorkspaceStatus");if(!workspace)invalid();
    const status=diffXmlChildren(workspace,new Set(["Status"])).get("Status");if(!status)invalid();
    const context=diffXmlChildren(status,new Set(["RepSpec","Changeset"]));
    const rep=context.get("RepSpec");if(!rep)invalid();
    const identity=diffXmlChildren(rep,new Set(["Server","Name"]));
    const repository=text(identity.get("Name")),server=text(identity.get("Server")),changeset=text(context.get("Changeset"));
    if(!repository||!server||! /^(?:0|[1-9][0-9]{0,19})$/.test(changeset)||/[;\u0000-\u001f\u007f-\u009f]/.test(repository+server)||repository.includes("@"))invalid();
    const items:DiffPendingItem[]=[],seen=new Set<string>();
    const changes=root.get("Changes");
    const allowed=new Set(["Type","TypeVerbose","Path","OldPath","PrintableMovedPath","MergesInfo","SimilarityPerUnit","Similarity","Size","PrintableSize","PrintableLastModified","RevisionType","LastModified"]);
    if(changes)for(let n=changes.firstChild;n;n=n.nextSibling) {
        if(n.nodeType!==1){if(n.nodeType!==8&&(n.nodeValue??"").trim())invalid();continue;}
        const e=n as Element;if(e.tagName!=="Change"||items.length>=20000)invalid();
        const fields=diffXmlChildren(e,allowed);for(const e of fields.values())text(e);
        const code=text(fields.get("Type"));if(!Object.hasOwn(kinds,code))invalid();
        const kind=kinds[code as keyof typeof kinds],p=path(text(fields.get("Path"))),old=text(fields.get("OldPath")),revisionType=text(fields.get("RevisionType"));
        if((kind==="moved")!==Boolean(old)||old&&path(old)===p||seen.has(p))invalid();seen.add(p);
        if(revisionType!=="enDirectory"&&revisionType!=="enTextFile"&&revisionType!=="enBinaryFile")invalid();
        items.push({path:p,sourcePath:old||null,kind,code,directory:revisionType==="enDirectory"});
    }
    return {items,repository,server,changeset};
}
