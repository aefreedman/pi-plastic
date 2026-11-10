import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configuredLiveWorkspace, parseLiveXml, PlasticLiveHarness, xmlTexts } from "./plastic-live-harness.ts";

const workspace = configuredLiveWorkspace(true);
if (!workspace) {
  console.log("SKIP: configure and attest an authorized disposable workspace for native review mutation acceptance");
  process.exit(0);
}
const live = await PlasticLiveHarness.create(workspace);
const owned: Array<{ id: string; title: string }> = [];
const initial = live.clean();
const status = parseLiveXml(live.native(["status", "--xml", "--encoding=utf-8"]).stdout);
const repositories = xmlTexts(status, "Name"), servers = xmlTexts(status, "Server");
assert.equal(repositories.length, 1); assert.equal(servers.length, 1);
const repository = `${repositories[0]}@${servers[0]}`;
const target = `cs:${initial.changeset}`;
const revisionXml = parseLiveXml(live.native(["find", "revision", `where changeset=${initial.changeset}`, "--xml", "--encoding=utf-8"]).stdout);
const revision = Array.from(revisionXml.getElementsByTagName("REVISION")).find(row => row.getElementsByTagName("TYPE")[0]?.textContent === "txt");
assert(revision, "Select a synthetic checked-in text change as the sandbox's loaded changeset; no fixture checkin is inferred.");
const revisionId = revision.getElementsByTagName("ID")[0]?.textContent;
assert(revisionId && /^[1-9][0-9]*$/.test(revisionId));
const description = "Native review acceptance: explicit description.\nSecond line.";
const replacement = "Replaced description.\nUpdated second line.";
const fileDescription = "Description supplied through a file.\nSecond line.";
const descriptionFile = join(live.evidenceDirectory, "review-description.txt");
await writeFile(descriptionFile, fileDescription, { flag: "wx" });

function nativeComments(id: string) {
  const doc = parseLiveXml(live.native(["find", "changereviewcomment", `where reviewid=${id}`, "--xml", "--encoding=utf-8"]).stdout);
  return Array.from(doc.getElementsByTagName("CHANGEREVIEWCOMMENT"));
}
function field(row: ReturnType<typeof nativeComments>[number], name: string) {
  return row.getElementsByTagName(name)[0]?.textContent ?? "";
}
function verifyDescription(id: string, expected: string) {
  // Native descriptions are timeline records with a stored [description] marker,
  // not ordinary review-wide conversation comments.
  const descriptions = nativeComments(id).filter(row => field(row, "TYPE") === "timeline" && field(row, "COMMENT").startsWith("[description]"));
  if (expected) assert.equal(descriptions.filter(row => field(row, "COMMENT") === `[description]${expected}`).length, 1, "Independent native query must observe the exact stored description.");
  else assert(descriptions.every(row => field(row, "COMMENT") === "[description]"), "Clearing must remove earlier description text.");
}
async function create(title: string, controls: Record<string, unknown>) {
  const start = live.toolCommands.length;
  const dto = await live.tool("plastic_codeReviewCreate", { target, title, repository, ...controls }, false);
  assert.equal(live.toolCommands.length, start + 1, "Review create must dispatch once, with no hidden readback/retry.");
  const id = dto.data.observedCreatedIdentity?.value;
  if (typeof id === "string" && /^[1-9][0-9]*$/.test(id)) owned.push({ id, title });
  assert.equal(dto.ok, true);
  assert(typeof id === "string" && /^[1-9][0-9]*$/.test(id), "Successful creation must emit its numeric identity; preserve evidence if absent.");
  return { id, dto };
}

let completed = false;
try {
  await live.scenario("description-create-replace-file-clear", async () => {
    const { id } = await create(`pi-native-review-${live.runId}`, { description, users: ["me"] });
    verifyDescription(id, description);
    await live.tool("plastic_codeReviewUpdate", { id, repository, description: replacement });
    verifyDescription(id, replacement);
    await live.tool("plastic_codeReviewUpdate", { id, repository, descriptionFile });
    verifyDescription(id, fileDescription);
    await live.tool("plastic_codeReviewUpdate", { id, repository, description: "" });
    verifyDescription(id, "");
  });
  const id = owned[0].id;
  await live.scenario("revision-anchor-apply-unapply", async () => {
    const added = await live.tool("plastic_codeReviewCommentAdd", { review: id, repository, comment: "Synthetic native change request.", revision: `revid:${revisionId}`, line: 1, type: "Change" });
    const commentGuid = added.data.observedGuid;
    assert(typeof commentGuid === "string");
    const rows = nativeComments(id);
    const row = rows.find(row => field(row, "GUID") === commentGuid);
    assert(row); assert.equal(field(row, "REVISIONID"), revisionId); assert.equal(field(row, "LINE"), "1"); assert.equal(field(row, "TYPE"), "change");
    const comments = await live.tool("plastic_codeReviewCommentFind", { review: id, maxItems: 500 });
    assert(comments.data.rows.some((row: { guid: string; revisionId: string }) => row.guid === commentGuid && row.revisionId === revisionId));
    await live.tool("plastic_codeReviewCommentApply", { commentGuid, changeset: target, repository });
    const applied = nativeComments(id).find(row => field(row, "GUID") === commentGuid);
    assert(applied); assert.equal(field(applied, "APPLIEDINCHANGESET"), initial.changeset);
    await live.tool("plastic_codeReviewCommentUnapply", { commentGuid, repository });
    const unapplied = nativeComments(id).find(row => field(row, "GUID") === commentGuid);
    assert(unapplied); assert.equal(field(unapplied, "APPLIEDINCHANGESET"), "-1");
  });
  await live.scenario("reviewer-membership-and-own-subscription", async () => {
    const membership = await live.tool("plastic_codeReviewReviewerList", { id, repository, output: "json" });
    assert.equal(membership.data.observedMembership.length, 1);
    await live.tool("plastic_codeReviewUnsubscribe", { id, repository });
    const unsubscribed = await live.tool("plastic_codeReviewSubscription", { id, repository, output: "json" });
    assert.equal(unsubscribed.data.observedSubscription.subscribed, "no");
    assert.equal(unsubscribed.data.observedSubscription.reason, "unsubscribed");
    await live.tool("plastic_codeReviewSubscribe", { id, repository });
    const subscribed = await live.tool("plastic_codeReviewSubscription", { id, repository, output: "json" });
    assert.equal(subscribed.data.observedSubscription.subscribed, "yes");
    assert.equal(live.native(["codereview", "subscription", id, `--repository=${repository}`, "--format={subscribed}"]).stdout.trim(), "yes");
  });
  await live.scenario("description-file-create-and-invalid-file-no-retry", async () => {
    const fromFile = await create(`pi-native-file-${live.runId}`, { descriptionFile });
    verifyDescription(fromFile.id, fileDescription);
    const title = `pi-native-invalid-file-${live.runId}`, start = live.toolCommands.length;
    const invalid = await live.tool("plastic_codeReviewCreate", { target, title, repository, descriptionFile: join(live.evidenceDirectory, "deliberately-missing-description.txt") }, false);
    assert.equal(invalid.ok, false);
    assert.equal(live.toolCommands.length, start + 1, "Failed creation must not retry.");
    assert.equal(invalid.data.attempt.terminal, "observed");
    assert.notEqual(invalid.data.attempt.exitCode, 0);
    assert.equal(invalid.data.observedCreatedIdentity, null);
    // A missing description file is validated before creation by this client.
    // Do not invent a partially created review; the emitted-ID failure path has
    // separate synthetic coverage and needs a genuine post-create server failure.
    const stored = parseLiveXml(live.native(["find", "review", `where title='${title}'`, "--xml", "--encoding=utf-8"]).stdout);
    assert.equal(xmlTexts(stored, "ID").length, 0);
  });
  completed = true;
} finally {
  // Delete only emitted identities whose independently observed title proves ownership.
  // Cleanup is intentional resource removal, not a claim that failed creation rolled back.
  for (const { id, title } of [...owned].reverse()) {
    const doc = parseLiveXml(live.native(["find", "review", `where id=${id}`, "--xml", "--encoding=utf-8"]).stdout);
    assert.deepEqual(xmlTexts(doc, "ID"), [id]); assert.deepEqual(xmlTexts(doc, "TITLE"), [title]);
    await live.tool("plastic_codeReviewDelete", { ids: [id], repository });
    const remaining = parseLiveXml(live.native(["find", "review", `where id=${id}`, "--xml", "--encoding=utf-8"]).stdout);
    assert.equal(xmlTexts(remaining, "ID").length, 0, "Temporary review deletion must be independently observed.");
    assert.equal(nativeComments(id).length, 0, "Temporary comments/descriptions must not remain after review deletion.");
  }
  assert.deepEqual(live.clean(initial.branch), initial, "Review mutations must not change workspace files, loaded branch/changeset or pending state.");
  const mutators = live.toolCommands.filter(call => !["plastic_codeReviewCommentFind", "plastic_codeReviewReviewerList", "plastic_codeReviewSubscription"].includes(call.tool));
  assert(mutators.every(call => call.args[0] === "codereview"), "No workspace/history mutation or fallback may be dispatched.");
  live.saveSummary({ outcome: completed ? "passed" : "failed", temporaryReviewsRemoved: owned.length, workspaceUnchanged: true });
  console.log(`${completed ? "PASS" : "FAILED"}: native review acceptance; ${owned.length} owned reviews removed, workspace unchanged; private evidence: ${live.evidenceDirectory}`);
}
