import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { parseStatusXml, StatusXmlError } from "../src/domain/status-xml";
import { diagnoseMachineReadablePendingItems, parseMachineReadablePendingItems, STATUS_FIELD_SEPARATOR as US } from "../src/domain/pending";
import { executeStatusOutput, projectStatusOutput, validateStatusOutput } from "../src/pi/status-output";
import { runWithAbortSignal } from "../src/execution/context";
import { xmlRecord } from "./fixtures/status-xml";
import { status as coreStatus } from "../src/operations/status";
import { loadRegisteredTools } from "./pi-tool-harness";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/plastic-real-inferred-move.json", import.meta.url), "utf8"));
const get = (label: string) => fixture.fixtures.find((row: any) => row.label === label)!;
const machine = get("032-inferred-move-machine");
const xml = get("032-inferred-move-xml");
for (const row of fixture.fixtures) {
    assert.equal(row.provenance.client, "11.0.16.10484");
    assert.equal(row.exit, 0); assert.equal(row.stderr, ""); assert.equal(row.error, null); assert.equal(row.signal, null);
}
const parse = (text: string) => parseStatusXml(Buffer.from(text));
const diagnose = (text: string) => diagnoseMachineReadablePendingItems(text, machine.cwd, "win32");
const parsed = parse(xml.stdout);
const row = parsed.items[0];
assert.deepEqual(row, { statusCode: "LM", kind: "moved", path: "C:\\Example\\workspace\\fixtures\\evidence\\move-destination.txt", sourcePath: "C:\\Example\\workspace\\fixtures\\evidence\\move-origin.txt", isDirectory: false, similarity: 0.9801980198019802 });
assert.equal(parsed.summary.moved, 1);
assert(!("revisionId" in row));
assert(xml.stdout.includes("<PrintableLastModified />"));
assert(xml.stdout.includes("<LastModified>0001-01-01T00:00:00</LastModified>"));
const diagnosed = diagnose(machine.stdout);
assert.equal(diagnosed.diagnostics.malformed, 0); assert.equal(diagnosed.diagnostics.unsupported, 0);
assert.equal(diagnosed.pendingItems.length, 1);
assert.equal(diagnosed.pendingItems[0].kind, "moved");
assert.equal(diagnosed.pendingItems[0].workspacePath, row.path);
assert.equal(diagnosed.pendingItems[0].sourceWorkspacePath, row.sourcePath);
assert.equal(diagnosed.pendingItems[0].revisionId, "978");
assert.equal(diagnosed.pendingItems[0].similarity, 0.9802);
assert.notEqual(diagnosed.pendingItems[0].similarity, row.similarity); // two producer precisions, not identity equality
// Do not migrate observation support into legacy mutation/diff selection.
assert.deepEqual(parseMachineReadablePendingItems(machine.stdout, machine.cwd), []);
const mv = machine.stdout.replace(`LM${US}`, `MV${US}`);
assert.equal(parseMachineReadablePendingItems(mv, machine.cwd)[0].kind, "moved");
assert.equal(diagnose(mv).pendingItems[0].sourceWorkspacePath, row.sourcePath);

const machineObservation = (text: string, capture: "complete" | "unknown" = "complete") => ({ kind: "machine" as const, output: text, cwd: machine.cwd, capture, requestedShort: false, ...diagnose(text) });
const machineDto = projectStatusOutput(machineObservation(machine.stdout));
assert(machineDto.ok && machineDto.data.mode === "machine");
assert.equal(machineDto.completeness.read, "complete");
assert.equal(machineDto.data.items[0].similarity, 0.9802);
assert.equal(projectStatusOutput(machineObservation(machine.stdout, "unknown")).completeness.read, "unknown");
const xmlDto = projectStatusOutput({ kind: "xml", ...parsed, capture: "complete", requestedShort: false });
assert(xmlDto.ok && xmlDto.data.mode === "xml");
assert.equal(xmlDto.schemaVersion, 2);
assert.equal(xmlDto.completeness.read, "complete");
assert.equal(xmlDto.data.source.baseRevisionAvailability, "unavailable");
for (const dto of [machineDto, xmlDto]) {
    const invalid = structuredClone(dto) as any; invalid.data.items[0].similarity = 1.01;
    assert.equal(validateStatusOutput(invalid, dto.schemaVersion).ok, false);
    delete invalid.data.items[0].similarity;
    assert.equal(validateStatusOutput(invalid, dto.schemaVersion).ok, false);
    const unsafe = structuredClone(dto) as any; unsafe.data.items[0].sourcePath = row.path;
    assert.equal(validateStatusOutput(unsafe, dto.schemaVersion).ok, false);
}
// All following mutations are adversarial/sizing derivatives, not native producer captures.
const record = xml.stdout.match(/    <Change>[\s\S]*?    <\/Change>/)![0];
const append = (extra: string) => xml.stdout.replace("  </Changes>", `${extra}\r\n  </Changes>`);
for (const bad of [
    append(record), append(record.replaceAll("move-destination", "MOVE-DESTINATION").replaceAll("move-origin", "other-origin")),
    append(xmlRecord(row.sourcePath!)), append(xmlRecord(row.path)),
    xml.stdout.replace(row.sourcePath!, row.path), xml.stdout.replace(row.sourcePath!, row.sourcePath!.replace("C:", "D:")),
    xml.stdout.replace(row.path, row.path.replace("\\move-destination", "\\..\\move-destination")),
    xml.stdout.replace(row.path, "relative"), xml.stdout.replace(row.path, row.path + ":stream"),
    xml.stdout.replace("<SimilarityPerUnit>0.9801980198019802</SimilarityPerUnit>", "<SimilarityPerUnit/>"),
    ...["-0.1", "1.01", "NaN", "Infinity", "1e-1", "0." + "1".repeat(65)].map(token => xml.stdout.replace("0.9801980198019802", token)),
    ...["101%", "-1%", "NaN%", "98", "1e2%"].map(token => xml.stdout.replace("98%", token)),
    xml.stdout.replace("<OldPath>", "<OldPath><Nested/>"), xml.stdout.replace("<Type>LM</Type>", "<Type>LM</Type><Type>LM</Type>"),
    xml.stdout.replace("<MergesInfo />", "<MergesInfo><Nested/></MergesInfo>"), xml.stdout.slice(0, -10), xml.stdout + "<Another/>",
]) assert.throws(() => parse(bad));
for (const order of [true, false]) {
    const unknown = xmlRecord("C:\\Example\\workspace\\unknown.txt", "FUTURE");
    const input = order ? append(unknown) : xml.stdout.replace(record, unknown + record);
    assert.throws(() => parse(input), (error: unknown) => error instanceof StatusXmlError && error.code === "unsupported_source");
    assert.throws(() => parse(input.replace(row.path, "relative")), (error: unknown) => error instanceof StatusXmlError && error.code === "malformed_output");
}
assert.equal(parse(xml.stdout.replace("98%", "89%")).items[0].similarity, row.similarity);
assert.deepEqual(parse(xml.stdout.replace(/<PrintableMovedPath>[^<]*<\/PrintableMovedPath>/, "<PrintableMovedPath>opaque safe scalar</PrintableMovedPath>")).items, parsed.items);
const lmLine = machine.stdout.split(/\r?\n/).find((line: string) => line.startsWith(`LM${US}`))!;
const fields = lmLine.split(US);
const mutate = (index: number, value: string) => fields.map((field: string, i: number) => i === index ? value : field).join(US);
for (const bad of [
    ...["101%", "-1%", "NaN%", "98", "1e2%", "98.02%%", "0." + "1".repeat(65) + "%"].map(percent => mutate(1, percent)),
    mutate(2, fields[3]), mutate(2, fields[2].toUpperCase().replace("MOVE-ORIGIN", "MOVE-DESTINATION")),
    mutate(2, fields[2].replace("C:", "D:")), mutate(3, "relative"), mutate(3, fields[3] + "\\..\\file"),
    mutate(4, "not-a-bool"), mutate(5, "-1"), mutate(5, "0"), mutate(5, "978.0"), mutate(6, "Merge from cs:54"),
    fields.slice(0, -1).join(US), lmLine + US + "extra", lmLine + "\n" + lmLine,
    lmLine + "\n" + mutate(2, fields[2].replace("move-origin", "other-origin")).replace("move-destination", "MOVE-DESTINATION"),
    lmLine + "\n" + ["CH", fields[2], "False", "978", "NO_MERGES"].join(US),
    ["CH", fields[3], "False", "978", "NO_MERGES"].join(US) + "\n" + lmLine,
    lmLine + "\n" + ["FUTURE", "x", "False", "978", "NO_MERGES"].join(US),
]) {
    const result = projectStatusOutput(machineObservation(bad));
    assert.equal(result.completeness.read, "incomplete", bad);
}
for (const percent of ["0%", "89%", "98.02%", "100%", "100.00%"]) assert.equal(diagnose(mutate(1, percent)).diagnostics.malformed, 0);

let calls: string[][] = [];
const registered = (await loadRegisteredTools()).get("plastic_status")!;
const invoke = async (source: "xml" | "machine", output: string | Buffer, format: "json" | "text" = "json", options: { stderr?: string; code?: number; route?: "core" | "registered" } = {}) => {
    calls = [];
    const spawn = ((_command: string, argv: string[], spawnOptions: any) => {
        calls.push(argv); assert.equal(spawnOptions.shell, false);
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
        queueMicrotask(() => { child.stdout.end(output); child.stderr.end(options.stderr ?? ""); child.emit("close", options.code ?? 0); });
        return child;
    }) as any;
    const args = { source, workdir: machine.cwd, format, includeRaw: true };
    return runWithAbortSignal(undefined, () => options.route === "core" ? coreStatus.execute(args) : options.route === "registered" ? registered.execute("fixture", args, undefined, undefined, { cwd: machine.cwd }) : executeStatusOutput(args), { spawn });
};
for (const source of ["xml", "machine"] as const) for (const format of ["text", "json"] as const) {
    const envelope = source === "xml" ? xml : machine;
    const result = await invoke(source, envelope.stdout, format);
    assert.equal(result.isError, false); assert.equal(result.structuredContent.completeness.read, "complete");
    assert.equal(calls.length, 1);
    // The package orders the same native flags differently from the evidence collector.
    assert.deepEqual([...calls[0]].sort(), [...envelope.argv].sort());
    assert(result.content[0].text.includes("move-origin")); assert(result.content[0].text.includes("move-destination"));
    if (format === "json") assert.equal(JSON.parse(result.content[0].text).ok, true);
    for (const options of [{ stderr: "private producer diagnostic" }, { code: 1 }]) {
        const failed = await invoke(source, envelope.stdout, format, options);
        if (source === "machine" && options.stderr) {
            assert.equal(failed.structuredContent.completeness.capture, "unknown");
            assert.equal(failed.structuredContent.completeness.read, "unknown");
        } else assert.equal(failed.isError, true);
        assert.equal(calls.length, 1);
        assert(!JSON.stringify(failed).includes("private producer diagnostic"));
    }
}
for (const source of ["xml", "machine"] as const) {
    const envelope = source === "xml" ? xml : machine;
    const registeredResult = await invoke(source, envelope.stdout, "json", { route: "registered" });
    assert.equal(registeredResult.structuredContent.completeness.read, "complete");
    assert.equal(registeredResult.structuredContent.data.items[0].kind, "moved");
    // Legacy core machine JSON intentionally retains its existing version lookup/rendering;
    // use text here rather than substituting a status receipt for a native version response.
    const core = await invoke(source, envelope.stdout, source === "xml" ? "json" : "text", { route: "core" });
    if (source === "xml") assert.equal(JSON.parse(core).data.items[0].similarity, row.similarity);
    else { assert(core.includes("move-origin")); assert(core.includes("move-destination")); }
    assert.equal(calls.length, 1);
}
assert.equal((await invoke("xml", xml.stdout.slice(0, -10))).isError, true);
assert.equal((await invoke("xml", Buffer.from([0xc3, 0x28]))).isError, true);
const partial = await invoke("machine", machine.stdout + "UNKNOWN\n");
assert.equal(partial.structuredContent.completeness.read, "incomplete");
assert(partial.content[0].text.includes('"withheld":true'));
console.log("PASS: exact inferred LM XML/machine observations, fractional metadata, typed output, whole-document/identity/capture negatives; legacy selection unchanged");
