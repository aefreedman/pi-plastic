import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { configuredLiveWorkspace, parseLiveXml, PlasticLiveHarness, xmlTexts } from "./plastic-live-harness.ts";

const workspace = configuredLiveWorkspace();
if (!workspace) {
  console.log("SKIP: set PI_PLASTIC_TEST_WORKSPACE to run native review/patch read-only validation");
  process.exit(0);
}
const live = await PlasticLiveHarness.create(workspace);
try {
  const initial = live.state();
  const version = live.native(["version"]).stdout.trim().split(".").map(Number);
  const minimum = [11, 0, 16, 10616];
  const difference = version.findIndex((part, index) => part !== minimum[index]);
  assert(version.length === minimum.length && version.every(Number.isSafeInteger) && (difference === -1 || version[difference] > minimum[difference]), "Native workflow validation requires CM 11.0.16.10616 or newer.");
  const status = parseLiveXml(live.native(["status", "--xml", "--encoding=utf-8"]).stdout);
  const names = xmlTexts(status, "Name"), servers = xmlTexts(status, "Server");
  assert.equal(names.length, 1); assert.equal(servers.length, 1);
  const repository = `${names[0]}@${servers[0]}`;

  const reviews = await live.tool("plastic_codeReviewFind", { source: "xml", limit: 20, maxItems: 20 });
  const nativeReviews = parseLiveXml(live.native(["find", "review", "limit 20", "--xml", "--encoding=utf-8"]).stdout);
  assert.deepEqual(reviews.data.rows.map((row: { id: string }) => row.id), xmlTexts(nativeReviews, "ID"), "Registered review inventory must agree with independent native XML.");
  assert.equal(reviews.completeness.projection, true);

  // Discover bounded existing comments; never manufacture live data through a mutation.
  const sample = parseLiveXml(live.native(["find", "changereviewcomment", "limit 10", "--xml", "--encoding=utf-8"]).stdout);
  const commentReviews = [...new Set(xmlTexts(sample, "REVIEWID"))].slice(0, 3);
  let commentsObserved = 0;
  for (const review of commentReviews) {
    assert(/^[1-9][0-9]{0,19}$/.test(review));
    const comments = await live.tool("plastic_codeReviewCommentFind", { review, maxItems: 500 });
    const native = parseLiveXml(live.native(["find", "changereviewcomment", `where reviewid=${review}`, "--xml", "--encoding=utf-8"]).stdout);
    assert.deepEqual(comments.data.rows.map((row: { guid: string }) => row.guid), xmlTexts(native, "GUID"));
    assert.deepEqual(comments.data.rows.map((row: { lastRepositoryPath: string }) => row.lastRepositoryPath), xmlTexts(native, "PATH"));
    assert.deepEqual(comments.data.rows.map((row: { itemId: string }) => row.itemId), xmlTexts(native, "ITEMID"));
    assert.deepEqual(comments.data.rows.map((row: { modifiedDate: string }) => row.modifiedDate), xmlTexts(native, "MODIFIEDDATE"));
    assert(comments.data.rows.every((row: { serverPath: null }) => row.serverPath === null), "Latest repository path is not review-path identity.");
    commentsObserved += comments.data.rows.length;
  }

  // Prefer populated reviews without splitting the ambiguous native REVIEWERS text.
  const candidates = [...reviews.data.rows].sort((left, right) => Number(Boolean(right.reviewersRaw)) - Number(Boolean(left.reviewersRaw)));
  let membersObserved = 0;
  for (const review of candidates.slice(0, 10)) {
    const membership = await live.tool("plastic_codeReviewReviewerList", { id: review.id, repository, output: "json" });
    const native = parseLiveXml(live.native(["codereview", "reviewer", "list", review.id, `--repository=${repository}`, "--xml", "--encoding=utf-8"]).stdout);
    assert.deepEqual(membership.data.observedMembership.map((member: { user: string }) => member.user), xmlTexts(native, "User"));
    assert.deepEqual(membership.data.observedMembership.map((member: { status: string }) => member.status), xmlTexts(native, "Status"));
    assert.deepEqual(membership.data.observedMembership.map((member: { type: string }) => member.type), xmlTexts(native, "Type"));
    membersObserved += membership.data.observedMembership.length;
    if (membersObserved) break;
  }
  if (candidates.length) {
    const id = candidates[0].id;
    const subscription = await live.tool("plastic_codeReviewSubscription", { id, repository, output: "json" });
    const native = live.native(["codereview", "subscription", id, `--repository=${repository}`, "--format={subscribed}{tab}{reason}{tab}{emails}"]).stdout.trimEnd();
    const observed = subscription.data.observedSubscription;
    assert.equal([observed.subscribed, observed.reason, observed.emails].join("\t"), native);
  }

  const source = `cs:${initial.changeset}`;
  const textPatch = await live.tool("plastic_patch", { source });
  assert.equal(textPatch.data.cleanup, "completed");
  const output = join(live.evidenceDirectory, "native-workflows.patch");
  // Native generation may legitimately produce no bytes for an empty changeset.
  const patch = await live.tool("plastic_patch", { source, includeBinaries: true });
  const nativeOutput = join(live.evidenceDirectory, "independent-native.patch");
  live.native(["patch", source, "--include-binaries", `--output=${nativeOutput}`]);
  const bytes = await readFile(nativeOutput);
  assert.equal(patch.data.artifact.bytes, bytes.length);
  if (!patch.data.artifact.empty) {
    const published = await live.tool("plastic_patch", { source, includeBinaries: true, output });
    assert.equal(published.data.publication, "published");
    assert.deepEqual(await readFile(output), bytes, "Published native patch must preserve exact bytes.");
  }
  const patchCalls = live.toolCommands.filter(call => call.tool === "plastic_patch");
  assert(patchCalls.every(call => call.args[0] === "patch" && !call.args.some(arg => /^--tool(?:=|$)/.test(arg)) && !call.args.includes("--apply")));
  assert(patchCalls.slice(1).every(call => call.args.includes("--include-binaries")));

  const final = live.state();
  assert.deepEqual(final, initial, "Review reads and patch generation must not change workspace, branch, changeset, pending scope or markers.");
  const coverage = { reviewRows: reviews.data.rows.length, commentRows: commentsObserved, reviewerRows: membersObserved, subscriptionRead: candidates.length > 0, patchBytes: bytes.length };
  live.saveSummary({ outcome: "passed", coverage });
  console.log(`PASS: native workflow read-only validation ${JSON.stringify(coverage)}; private evidence: ${live.evidenceDirectory}`);
  if (!commentsObserved || !membersObserved) console.log("COVERAGE GAP: nonempty comments/reviewers require existing sandbox data; this suite never creates it.");
} catch (error) {
  live.saveSummary({ outcome: "failed", error: String(error) });
  console.error(`Native workflow validation failed; private evidence: ${live.evidenceDirectory}`);
  throw error;
}
