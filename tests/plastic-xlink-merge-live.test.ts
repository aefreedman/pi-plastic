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
  writeFileSync(linkedFile,"linked baseline\n");
  for(let i=0;i<40;i++)writeFileSync(join(mount,`bulk-${i}.txt`),`base ${i}\n`);
  live.native(["add",mount,"-R"]);const baseline=setup("pi-plastic Xlink merge baseline");
  live.createBranch(source);live.switch(source);writeFileSync(rootFile,"root source\n");writeFileSync(linkedFile,"linked source\n");
  for(let i=0;i<40;i++)writeFileSync(join(mount,`bulk-${i}.txt`),`source ${i}\n`);
  const incoming=setup("pi-plastic Xlink merge source");
  const sourceFiles=xmlTexts(parseLiveXml(live.native(["ls",mount,"-R","--xml","--encoding=utf-8"]).stdout),"Name");
  assert(sourceFiles.filter(name=>name.startsWith("bulk-")).length>=40,"Size regression must actually contain >32 linked tree entries before applying.");
  const sourceLinked=incoming.linkedChangesets[0];
  const changedPaths=xmlTexts(parseLiveXml(live.native(["log",`cs:${sourceLinked.id}@${sourceLinked.repository}@${sourceLinked.server}`,"--xml"]).stdout),"DstCmPath");
  assert(changedPaths.filter(path=>path.includes("bulk-")).length>=40,"Size regression must actually change >32 linked files before applying.");
  const start=live.toolCommands.length;
  let checked;
  if(scenario==="standalone") {
   live.switch(target);
   const merged=await live.tool("plastic_merge",{source:`cs:${incoming.changesets[0].id}`,format:"json"});
   assert(merged.data.commandCompleted);
   const preview=await live.tool("plastic_checkin",{message:"pi-plastic native Xlink merge",includeAll:true,preflight:true,format:"json"});assert.equal(preview.outcome,"preflight");
   checked=await live.tool("plastic_checkin",{message:"pi-plastic owned Xlink merge",includeAll:true,format:"json"});
  } else {
   const closeout=await live.tool("plastic_mergeToBranch",{source,target,updateTarget:false,message:"pi-plastic Xlink full closeout",format:"json"});
   const stages=closeout.data.stages;
   checked=stages.find((s:any)=>s.name==="checkin").result;
  }
  assert(checked.data.commandCompleted);assert.equal(checked.data.linkedChangesets.length,1);
  for(let i=0;i<40;i++)assert.equal(readFileSync(join(mount,`bulk-${i}.txt`),"utf8"),`source ${i}\n`);
  const linked=checked.data.linkedChangesets[0];
  assert.equal(readFileSync(rootFile,"utf8"),"root source\n");assert.equal(readFileSync(linkedFile,"utf8"),"linked source\n");
  live.verifyIntegration(checked.data.createdChangeset.id,target,incoming.changesets[0].id,baseline.changesets[0].id,[relative(workspace,rootFile)]);
  const linkedLog=parseLiveXml(live.native(["log",`cs:${linked.id}@${linked.repository}@${linked.server}`,"--ancestors",`--from=cs:${baseline.linkedChangesets[0].id}@${linked.repository}@${linked.server}`,"--xml"]).stdout);
  assert(xmlTexts(linkedLog,"ChangesetId").includes(incoming.linkedChangesets[0].id));assert.equal(xmlTexts(linkedLog,"Branch")[0],linked.branch);
  assert.equal(live.native(["cat",`${rootFile}#cs:${checked.data.createdChangeset.id}`]).stdout,"root source\n");assert.equal(live.native(["cat",`${linkedFile}#cs:${linked.id}`]).stdout,"linked source\n");
  const commands=live.toolCommands.slice(start);assert(!commands.some(c=>["fileinfo","ls"].includes(c.args[0])),"No ownership proof queries");assert.equal(commands.filter(c=>c.args[0]==="merge"&&c.args.includes("--merge")).length,1);assert.equal(commands.filter(c=>c.args[0]==="checkin").length,1);
  live.clean(target);live.switch(original.branch);assert.equal(live.clean(original.branch).changeset,original.changeset);
  live.record("scenario-passed",{scenario,target,source,baseline,incoming,checked});
 }
 live.saveSummary({outcome:"passed",original,final:live.clean(original.branch)});console.log(`PASS: native writable-Xlink >32 file merge/checkin and compound closeout; independent both-repository ancestry/history/bytes; ${live.evidenceDirectory}`);
} catch(error) {live.saveSummary({outcome:"failed-preserved",error:String(error)});console.error(`STOP preserved sandbox; ${live.evidenceDirectory}`);throw error;}
