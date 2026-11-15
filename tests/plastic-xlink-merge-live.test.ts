import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { configuredLiveWorkspace, PlasticLiveHarness, parseLiveXml, xmlTexts } from "./plastic-live-harness.ts";
import { parseCheckinEvidence } from "../src/domain/checkin-contract.ts";
const workspace = configuredLiveWorkspace(true), linkedRepository = process.env.PI_PLASTIC_TEST_XLINK_REPOSITORY?.trim();
if (!workspace || !linkedRepository) { console.log("SKIP: configure an authorized disposable workspace and existing synthetic linked repository"); process.exit(0); }
const live = await PlasticLiveHarness.create(workspace);
try {
 const original = live.clean();
 const context = parseLiveXml(live.native(["status", "--xml", "--encoding=utf-8"]).stdout), server = xmlTexts(context,"Server")[0];
 for (const scenario of (process.env.PI_PLASTIC_XLINK_SCENARIOS??"standalone,closeout").split(",")) {
  assert(["standalone","closeout"].includes(scenario));
  const target = `${original.branch}/pi-xmerge-${live.runId}-${scenario}`, source = target+"/source", directory = join(workspace,"fixtures",`pi-xmerge-${live.runId}-${scenario}`);
  const rootFile=join(directory,"root.txt"),mount=join(directory,"mount"),linkedFile=join(mount,"linked.txt");
  const setup=(message:string)=>{const seps={start:"__SETUP_S__",end:"__SETUP_E__",field:"__SETUP_F__"};const output=live.native(["checkin",directory,"--applychanged","--private","--machinereadable",`--startlineseparator=${seps.start}`,`--endlineseparator=${seps.end}`,`--fieldseparator=${seps.field}`,`-c=${message}`]);const p=parseCheckinEvidence(output.stdout,seps);assert(p.admitted);assert.equal(p.changesets.length,1);live.clean();return p;};
  live.createBranch(target);live.switch(target);mkdirSync(directory,{recursive:true});writeFileSync(rootFile,"root baseline\n");live.native(["add",rootFile]);live.native(["xlink","-w",mount,"/",`cs:0@${linkedRepository}@${server}`]);setup("pi-plastic Xlink merge mount setup");
  writeFileSync(linkedFile,"linked baseline\n");live.native(["add",linkedFile]);const baseline=setup("pi-plastic Xlink merge baseline");
  live.createBranch(source);live.switch(source);writeFileSync(rootFile,"root source\n");writeFileSync(linkedFile,"linked source\n");const incoming=setup("pi-plastic Xlink merge source");
  const start=live.toolCommands.length;
  let checked;
  if(scenario==="standalone") {
   live.switch(target);
   const merged=await live.tool("plastic_merge",{source:`cs:${incoming.changesets[0].id}`,format:"json"});
   assert(merged.data.assessment.ownership.complete);assert.equal(merged.data.assessment.ownership.reads.length,4);
   // Retain exact native profiles privately for independently sanitized fixtures.
   live.native(["status","--machinereadable","--includeRevId","--fieldseparator=\x1f"]);live.native(["status"]);
   live.native(["fileinfo",rootFile,linkedFile,"--fields=ClientPath,RepSpec,IsXlink,XlinkTarget,IsUnderXlink,UnderXlinkTarget,UnderXlinkPath,UnderXlinkWritable","--xml","--encoding=utf-8"]);
   live.native(["fileinfo",mount,"--fields=ClientPath,RepSpec,IsXlink,XlinkTarget,IsUnderXlink,UnderXlinkTarget,UnderXlinkPath,UnderXlinkWritable","--xml","--encoding=utf-8"]);
   for(const id of [baseline.changesets[0].id,incoming.changesets[0].id]) live.native(["ls","/"+relative(workspace,mount).replaceAll("\\","/"),`--tree=cs:${id}@${baseline.changesets[0].repository}@${server}`,"-R","--xml","--encoding=utf-8"]);
   const preview=await live.tool("plastic_checkin",{message:"pi-plastic owned Xlink merge",includeAll:true,preflight:true,format:"json"});assert(preview.data.assessment.ownership.complete);
   checked=await live.tool("plastic_checkin",{message:"pi-plastic owned Xlink merge",includeAll:true,format:"json"});
  } else {
   const closeout=await live.tool("plastic_mergeToBranch",{source,target,updateTarget:false,message:"pi-plastic Xlink full closeout",format:"json"});
   const stages=closeout.data.stages;assert(stages.find((s:any)=>s.name==="loaded-before-checkin").result.assessment.ownership.complete);
   checked=stages.find((s:any)=>s.name==="checkin").result;
  }
  assert(checked.data.assessment.ownership.complete);assert.equal(checked.data.linkedChangesets.length,1);
  const linked=checked.data.linkedChangesets[0];assert.equal(linked.branch,checked.data.assessment.ownership.mount.branch);
  assert.equal(readFileSync(rootFile,"utf8"),"root source\n");assert.equal(readFileSync(linkedFile,"utf8"),"linked source\n");
  live.verifyIntegration(checked.data.createdChangeset.id,target,incoming.changesets[0].id,baseline.changesets[0].id,[relative(workspace,rootFile)]);
  const linkedLog=parseLiveXml(live.native(["log",`cs:${linked.id}@${linked.repository}@${linked.server}`,"--ancestors",`--from=cs:${baseline.linkedChangesets[0].id}@${linked.repository}@${linked.server}`,"--xml"]).stdout);
  assert(xmlTexts(linkedLog,"ChangesetId").includes(incoming.linkedChangesets[0].id));assert.equal(xmlTexts(linkedLog,"Branch")[0],linked.branch);
  assert.equal(live.native(["cat",`${rootFile}#cs:${checked.data.createdChangeset.id}`]).stdout,"root source\n");assert.equal(live.native(["cat",`${linkedFile}#cs:${linked.id}`]).stdout,"linked source\n");
  const commands=live.toolCommands.slice(start);assert.equal(commands.filter(c=>c.args[0]==="merge"&&c.args.includes("--merge")).length,1);assert.equal(commands.filter(c=>c.args[0]==="checkin").length,1);
  live.clean(target);live.switch(original.branch);assert.equal(live.clean(original.branch).changeset,original.changeset);
  live.record("scenario-passed",{scenario,target,source,baseline,incoming,checked});
 }
 live.saveSummary({outcome:"passed",original,final:live.clean(original.branch)});console.log(`PASS: one writable-Xlink merge/checkin and compound closeout; independent both-repository ancestry/history/bytes; ${live.evidenceDirectory}`);
} catch(error) {live.saveSummary({outcome:"failed-preserved",error:String(error)});console.error(`STOP preserved sandbox; ${live.evidenceDirectory}`);throw error;}
