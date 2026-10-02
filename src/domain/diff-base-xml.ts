import { DOMParser, type Element } from "@xmldom/xmldom";

export class DiffBaseXmlError extends Error { constructor() { super("Loaded-file XML did not match the diff source contract."); } }
function invalid(): never { throw new DiffBaseXmlError(); }
export function parseDiffXml(bytes: Uint8Array, rootName: string): Element {
    if (bytes.byteLength > 1048576) invalid();
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal:true }).decode(bytes); } catch { return invalid(); }
    if (!/^<\?xml\s+version=["']1\.0["']\s+encoding=["']utf-8["']\s*\?>/i.test(text) || /<!DOCTYPE|<!ENTITY/i.test(text)) invalid();
    let document;
    try { document = new DOMParser({ locator:false, onError:invalid }).parseFromString(text,"application/xml"); } catch { return invalid(); }
    const root = document.documentElement;
    if (!root || root.tagName !== rootName || document.doctype) invalid();
    const stack: Array<[Element,number]> = [[root,1]];
    let count=0;
    while(stack.length) {
        const [e,depth]=stack.pop()!;
        if (++count>20000 || depth>32 || e.attributes.length || e.namespaceURI) invalid();
        let length=0;
        for(let n=e.firstChild;n;n=n.nextSibling) {
            if(n.nodeType===1) stack.push([n as Element,depth+1]);
            else if(n.nodeType===3 || n.nodeType===4) length+=(n.nodeValue??"").length;
            else if(n.nodeType!==8) invalid();
        }
        if(length>8192) invalid();
    }
    return root;
}
export function diffXmlChildren(e:Element, allowed:ReadonlySet<string>):Map<string,Element> {
    const result=new Map<string,Element>();
    for(let n=e.firstChild;n;n=n.nextSibling) {
        if(n.nodeType===1) { const child=n as Element; if(!allowed.has(child.tagName)||result.has(child.tagName)) invalid();result.set(child.tagName,child); }
        else if(n.nodeType!==8 && (n.nodeValue??"").trim()) invalid();
    }
    return result;
}
export function diffXmlLeaf(e:Element|undefined):string { if(!e||e.getElementsByTagName("*").length)invalid();return e.textContent??""; }
const decimal=(s:string)=>{if(!/^(?:0|[1-9][0-9]{0,19})$/.test(s))invalid();return s;};
const safe=(s:string,empty=false)=>{if((!empty&&!s)||s.length>4096||/[\u0000-\u001f\u007f-\u009f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s))invalid();return s;};
export type LoadedFileInfo={clientPath:string;serverPath:string;changeset:string;hash:string;repSpec:string;status:string;type:string};
export function parseLoadedFileInfo(bytes:Uint8Array):LoadedFileInfo {
    const root=parseDiffXml(bytes,"FileInfos");
    const row=diffXmlChildren(root,new Set(["FileInfo"])).get("FileInfo");if(!row)invalid();
    const fields=diffXmlChildren(row,new Set(["ClientPath","ServerPath","RevisionChangeset","Hash","RepSpec","Status","Type"]));
    const get=(name:string)=>diffXmlLeaf(fields.get(name));
    const result={clientPath:safe(get("ClientPath")),serverPath:safe(get("ServerPath")),changeset:decimal(get("RevisionChangeset")),hash:safe(get("Hash")),repSpec:safe(get("RepSpec"),true),status:safe(get("Status")),type:safe(get("Type"))};
    if(!result.serverPath.startsWith("/") || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.hash))invalid();
    return result;
}
export type LoadedLsItem={path:string;revisionId:string;changeset:string;hash:string;algorithm:"md5"|"sha1";repository:string;server:string;type:string};
export function parseLoadedLs(bytes:Uint8Array):LoadedLsItem {
    const root=parseDiffXml(bytes,"LsResults");
    const container=diffXmlChildren(root,new Set(["LsItems"])).get("LsItems");if(!container)invalid();
    const row=diffXmlChildren(container,new Set(["LsItem"])).get("LsItem");if(!row)invalid();
    const allowed=new Set(["Status","Name","CurrentPath","WkPath","Size","FormattedSize","Type","Changeset","Repository","Owner","Checkout","BrId","RevId","ParentRevId","ItemId","RepId","Server","SymlinkTarget","Hash","HashAlgorithm","Chmod","Branch","Guid","ItemGuid","Date"]);
    const fields=diffXmlChildren(row,allowed);for(const e of fields.values())diffXmlLeaf(e);
    const get=(name:string)=>diffXmlLeaf(fields.get(name));
    const server=safe(get("Server")),spec=safe(get("Repository"));
    if(!spec.startsWith("rep:") || !spec.endsWith("@"+server))invalid();
    const repository=spec.slice(4,-server.length-1);safe(repository);if(repository.includes("@"))invalid();
    const algorithm=get("HashAlgorithm").toLowerCase();if(algorithm!=="md5"&&algorithm!=="sha1")invalid();
    const result:LoadedLsItem={path:safe(get("CurrentPath")),revisionId:decimal(get("RevId")),changeset:decimal(get("Changeset")),hash:safe(get("Hash")),algorithm,repository,server,type:safe(get("Type"))};
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(result.hash))invalid();
    return result;
}
