import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { performance } from "node:perf_hooks";
import { Check } from "typebox/value";
import { parseStatusXml, StatusXmlError, STATUS_XML_LIMITS } from "../src/domain/status-xml";
import { resolveStatusSource, status as coreStatus } from "../src/operations/status";
import { statusOutputSchema, validateStatusOutput } from "../src/pi/status-output";
import { runWithAbortSignal } from "../src/execution/context";
import { loadRegisteredTools } from "./pi-tool-harness";
import { xmlRecord, xmlStatus } from "./fixtures/status-xml";

const parse = (text: string) => parseStatusXml(Buffer.from(text));
const mixed = xmlStatus([xmlRecord(), xmlRecord("/synthetic/ordinary.txt", "CH"), xmlRecord("/synthetic/deleted.txt", "DE"), xmlRecord("/synthetic/local.txt", "LD"), xmlRecord("/synthetic/new.txt", "MV", "/synthetic/old.txt"), xmlRecord("/synthetic/directory", "AD", "", true)].join(""));
assert.equal(parse(mixed).items.length, 6);
assert.deepEqual(parse(mixed).items[4], { statusCode: "MV", kind: "moved", path: "/synthetic/new.txt", sourcePath: "/synthetic/old.txt", isDirectory: false });
assert.equal(parse(mixed).items[5].isDirectory, true);
assert.equal(parse(xmlStatus()).items.length, 0);
// xmldom warns on literal U+FFFD even with valid bytes: strict warning policy rejects it.
assert.throws(() => parse(xmlStatus(xmlRecord("/synthetic/literal-�.txt"))));
assert.equal(parse(xmlStatus(xmlRecord("/synthetic/reference-&#xFFFD;.txt"))).items[0].path, "/synthetic/reference-�.txt");
assert.equal(parse(xmlStatus(xmlRecord("/synthetic/a&amp;b&#x65;&#769;&#x1F600;.txt"))).items[0].path, "/synthetic/a&bé😀.txt");
assert.equal(parseStatusXml(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(mixed)])).items.length, 6);
for (const bad of [mixed.replace('utf-8', 'utf-16'), mixed.replace('utf-8', 'windows-1252'), mixed.replace('<?xml version="1.0" encoding="utf-8"?>', ''), '<StatusOutput/>', xmlStatus('<Foreign/>'), xmlStatus(xmlRecord().replace('<Type>PR</Type>', '<Type>ZZ</Type>')), xmlStatus(xmlRecord().replace('<Path>', '<Unknown>')), xmlStatus(xmlRecord().replace('enTextFile', 'enBinaryFile')), xmlStatus(xmlRecord('/synthetic/a', 'MV')), xmlStatus(xmlRecord('/synthetic/a', 'CH', '/synthetic/b')), xmlStatus(xmlRecord('/synthetic/a') + xmlRecord('/synthetic/a')), xmlStatus(xmlRecord('relative')), mixed.slice(0, -1), mixed + '<another/>', mixed.replace('<Type>PR</Type>', '<Type>PR</Type><Type>PR</Type>'), mixed.replace('<StatusOutput>', '<StatusOutput attr="1">'), mixed.replace('<StatusOutput>', '<StatusOutput xmlns="foreign">')]) assert.throws(() => parse(bad));
// Genuine base revisions are absent on this transport. These numeric fields are explicitly synthetic,
// including 0 and -1; the parser must not manufacture or accept an XML revision contract.
for (const token of ['0', '-1', '41', 'oops']) assert.throws(() => parse(xmlStatus(xmlRecord().replace('</Change>', `<RevisionId>${token}</RevisionId></Change>`))));
for (const dtd of ['<!DOCTYPE StatusOutput SYSTEM "http://synthetic.invalid/never">', '<!DOCTYPE StatusOutput [<!ENTITY a SYSTEM "file:///never">]>', '<!DOCTYPE StatusOutput [<!ENTITY a "abc"><!ENTITY b "&a;&a;">]>']) assert.throws(() => parse(mixed.replace('<StatusOutput>', dtd + '<StatusOutput>')));
assert.throws(() => parse(xmlStatus(xmlRecord('/synthetic/&unknown;'))));
assert.throws(() => parseStatusXml(Buffer.from([0xc3, 0x28])));
assert.throws(() => parseStatusXml(Buffer.concat([Buffer.from(mixed), Buffer.from([0xc3])])));
assert.throws(() => parseStatusXml(Buffer.from([0xff, 0xfe, 0x3c, 0])));
for (const entity of ['&#0;', '&#xD800;', '&#xFFFF;']) assert.throws(() => parse(xmlStatus(xmlRecord('/synthetic/' + entity))));
assert.throws(() => parse(xmlStatus(xmlRecord('/' + 'x'.repeat(4096)))));
assert.throws(() => parse(xmlStatus(xmlRecord().replace('<Type>PR</Type>', '<Type>' + 'A'.repeat(65) + '</Type>'))));
assert.throws(() => parse(xmlStatus(xmlRecord().replace('</Change>', '<TypeVerbose>' + 'x'.repeat(8193) + '</TypeVerbose></Change>'))));
assert.throws(() => parse(xmlStatus(xmlRecord().replace('<Path>/synthetic/日本-é-😀.txt</Path>', '<Path>/' + 'x'.repeat(2048) + '<![CDATA[' + 'y'.repeat(2048) + ']]></Path>'))));
assert.throws(() => parse(xmlStatus('<Change/>'.repeat(20001))));
assert.throws(() => parse(xmlStatus('<x>'.repeat(17) + '</x>'.repeat(17))));
assert.throws(() => parseStatusXml(Buffer.alloc(STATUS_XML_LIMITS.stdoutBytes + 1, 32)));
// Synthetic unsupported profiles remain fail-closed; malformed/unsafe data takes precedence.
const unsupportedKind = xmlRecord().replace('enTextFile', 'enBinaryFile');
const unsupportedStatus = xmlRecord('/synthetic/unadmitted.txt', 'CP');
const unsafeRecord = xmlRecord('relative-private-value');
for (const input of [xmlStatus(unsupportedKind), xmlStatus(unsupportedStatus)]) {
  assert.throws(() => parse(input), (error: unknown) => error instanceof StatusXmlError && error.code === 'unsupported_source');
}
for (const input of [mixed.slice(0, -1), xmlStatus(xmlRecord().replace('<Type>PR</Type>', '<Type></Type>')), xmlStatus(xmlRecord().replace('enTextFile', '')), xmlStatus(unsupportedKind + unsafeRecord), xmlStatus(unsafeRecord + unsupportedKind)]) {
  assert.throws(() => parse(input), (error: unknown) => error instanceof StatusXmlError && error.code === 'malformed_output');
}
for (const input of [xmlStatus('<Change/>'.repeat(20001)), xmlStatus('<x>'.repeat(17) + '</x>'.repeat(17)), xmlStatus(xmlRecord('/' + 'x'.repeat(4096)))]) {
  assert.throws(() => parse(input), (error: unknown) => error instanceof StatusXmlError && error.code === 'output_overflow');
}
assert.throws(() => parseStatusXml(Buffer.alloc(STATUS_XML_LIMITS.stdoutBytes + 1)), (error: unknown) => error instanceof StatusXmlError && error.code === 'output_overflow');
const start = performance.now();
for (const input of [xmlStatus('<x>'.repeat(10000) + '</x>'.repeat(10000)), xmlStatus('<Change/>'.repeat(20001)), xmlStatus(xmlRecord().replace('</Change>', '<TypeVerbose>' + 'x'.repeat(900000) + '</TypeVerbose></Change>'))]) assert.throws(() => parse(input));
const adversarialMs = performance.now() - start;
assert(adversarialMs < 5000, 'bounded adversarial parser performance exceeded five seconds');
console.log(`PASS: bounded adversarial DOM probes completed in ${Math.round(adversarialMs)}ms (5000ms ceiling)`);

for (const source of [undefined, 'text', 'machine', 'xml'] as const) for (const machineReadable of [undefined, false, true]) {
  const args = { source, machineReadable };
  const conflict = source === 'machine' && machineReadable === false || (source === 'text' || source === 'xml') && machineReadable === true;
  if (conflict) assert.throws(() => resolveStatusSource(args));
  else assert.equal(resolveStatusSource(args), source ?? (machineReadable ? 'machine' : 'text'));
}
const tools = await loadRegisteredTools(); const registered = tools.get('plastic_status')!;
let calls: string[][] = [], children: any[] = [];
const invoke = async (output: Buffer | string = mixed, args: Record<string, unknown> = {}, options: { stderr?: Buffer | string; code?: number; split?: number; signal?: AbortSignal; timeout?: boolean; spawnError?: boolean; streamError?: boolean; abortDuring?: AbortController } = {}) => {
  calls = []; children = [];
  const spawn = ((_command: string, argv: string[], spawnOptions: any) => {
    assert.equal(spawnOptions.shell, false); calls.push(argv);
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: (_signal: string) => { queueMicrotask(() => { child.stdout.end(); child.stderr.end(); child.emit('close', 1); }); return true; } }); children.push(child);
    queueMicrotask(() => {
      if (options.spawnError) { child.emit('error', Error('private launch diagnostic')); return; }
      if (options.timeout) return;
      if (options.streamError) { child.stdout.destroy(Error('private stream diagnostic')); child.stderr.end(); child.emit('close', 0); return; }
      const bytes = Buffer.from(output);
      if (options.split !== undefined) { child.stdout.write(bytes.subarray(0, options.split)); child.stdout.write(bytes.subarray(options.split)); }
      else child.stdout.write(bytes);
      child.stderr.end(options.stderr ?? ''); child.stdout.end();
      options.abortDuring?.abort(); child.emit('close', options.code ?? 0);
    });
    return child;
  }) as any;
  const result = await runWithAbortSignal(options.signal ?? options.abortDuring?.signal, () => registered.execute('fixture', { source: 'xml', ...args }, undefined, undefined, { cwd: '/synthetic' }), { spawn, ...(options.timeout ? { timeoutMs: 1, abortKillDelayMs: 1 } : {}) });
  assert(Check(statusOutputSchema, result.structuredContent));
  for (const child of children) { assert.equal(child.listenerCount('close'), 0); assert.equal(child.listenerCount('error'), 0); assert.equal(child.stdout.listenerCount('data'), 0); assert.equal(child.stderr.listenerCount('data'), 0); }
  return result;
};
for (const [input, code] of [
  [xmlStatus(unsupportedKind), 'unsupported_source'], [xmlStatus(unsupportedStatus), 'unsupported_source'],
  [mixed.slice(0, -1), 'malformed_output'], [xmlStatus(unsupportedKind + unsafeRecord), 'malformed_output'],
  [xmlStatus('<Change/>'.repeat(20001)), 'output_overflow'],
] as const) {
  const failed = await invoke(input, { includeRaw: true, workdir: '/synthetic/private-workdir' });
  assert.equal(failed.structuredContent.error.code, code);
  assert.equal(failed.structuredContent.schemaVersion, 2);
  assert.deepEqual(failed.structuredContent.completeness, { read: 'incomplete', capture: 'complete', projection: false });
  assert.equal(failed.isError, true); assert(!('data' in failed.structuredContent));
  assert.equal(failed.details.rawResult, undefined); assert.equal(failed.details.workdir, undefined);
  for (const privateValue of ['<StatusOutput>', 'enBinaryFile', 'CP', 'synthetic.invalid', 'relative-private-value', '/synthetic']) assert(!JSON.stringify(failed).includes(privateValue));
}
const transportLimit = await invoke(Buffer.alloc(STATUS_XML_LIMITS.stdoutBytes + 1));
assert.equal(transportLimit.structuredContent.error.code, 'capture_incomplete');
assert.equal(transportLimit.structuredContent.completeness.capture, 'unknown');
const result = await invoke(mixed, { maxItems: 2, format: 'json', includeRaw: true });
assert.equal(calls.length, 1); assert.deepEqual(calls[0], ['status', '--xml', '--encoding=utf-8', '--fullpaths']);
const dto = result.structuredContent;
assert.equal(dto.schemaVersion, 2); assert.equal(dto.data.mode, 'xml'); assert.equal(dto.data.source.baseRevisionAvailability, 'unavailable'); assert.equal(dto.data.source.scope, 'workspace');
assert.deepEqual(dto.data.itemCount, { parsed: 6, returned: 2, omitted: 4, excluded: 0, overCap: 4 });
assert.equal(dto.data.summary.totalPending, 6); assert.equal(dto.data.summary.deleted, 2); assert.equal(dto.completeness.projection, false);
assert(!JSON.stringify(dto).includes('rawXml')); assert(!JSON.stringify(dto).includes('cliVersion')); assert.match(result.details.rawResult, /Raw XML contains private/);
const text = await invoke(mixed); assert.match(text.details.rawResult, /synthesized/); assert(!text.details.rawResult.includes('<StatusOutput>')); assert.equal(calls.length, 1);
for (const args of [{ short: true }, { includeRevId: true }, { machineReadable: true }]) { const error = await invoke(mixed, args); assert.equal(calls.length, 0); assert.equal(error.isError, true); assert.equal(error.structuredContent.schemaVersion, 2); }
for (const args of [{ source: 'text', machineReadable: true }, { source: 'machine', machineReadable: false }]) { const error = await invoke(mixed, args); assert.equal(calls.length, 0); assert.equal(error.isError, true); assert.equal(error.structuredContent.schemaVersion, 1); }
assert.equal((await invoke(xmlStatus())).structuredContent.data.itemCount.parsed, 0);
const replacement = await invoke(xmlStatus(xmlRecord('/synthetic/literal-�.txt'))); assert.equal(replacement.isError, true); assert.equal(calls.length, 1); assert(!('data' in replacement.structuredContent));
assert.equal((await invoke(xmlStatus(xmlRecord('/synthetic/reference-&#xFFFD;.txt')))).structuredContent.data.items[0].path, '/synthetic/reference-�.txt');
for (const row of dto.data.items) assert.equal(row.revisionId, undefined);
for (const bytes of [Buffer.from('foreign'), Buffer.concat([Buffer.from(mixed), Buffer.from([0xc3])]), Buffer.alloc(STATUS_XML_LIMITS.stdoutBytes + 1, 32)]) { const error = await invoke(bytes); assert(error.isError); assert(!('data' in error.structuredContent)); }
for (const options of [{ stderr: 'private diagnostic' }, { stderr: Buffer.alloc(65537, 32) }, { code: 1 }, { spawnError: true }, { streamError: true }, { timeout: true }, { abortDuring: new AbortController() }]) { const error = await invoke(mixed, {}, options); assert(error.isError); assert(!JSON.stringify(error).includes('private diagnostic')); }
const aborted = new AbortController(); aborted.abort(); assert.equal((await invoke(mixed, {}, { signal: aborted.signal })).structuredContent.error.code, 'aborted'); assert.equal(calls.length, 0);
// Timeout escalation and independent stream cleanup must settle even if SIGTERM is ignored.
const kills: string[] = []; const timers = new Set<NodeJS.Timeout>();
const escalatingSpawn = (() => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: (signal: string) => {
    kills.push(signal);
    if (signal === 'SIGKILL') queueMicrotask(() => { child.stdout.end(); child.stderr.end(); child.emit('close', null); });
    return true;
  } }); return child;
}) as any;
const timed = await runWithAbortSignal(undefined, () => registered.execute('fixture', { source: 'xml' }, undefined, undefined, { cwd: '/synthetic' }), { spawn: escalatingSpawn, timeoutMs: 1, abortKillDelayMs: 1, setTimeout: (callback, delay) => { const timer = setTimeout(callback, delay); timers.add(timer); return timer; }, clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); } });
assert.deepEqual(kills, ['SIGTERM', 'SIGKILL']); assert.equal(timers.size, 0); assert.equal(timed.structuredContent.error.code, 'capture_incomplete');
const decodedSpawn = (() => { const child = Object.assign(new EventEmitter(), { stdout: new PassThrough().setEncoding('utf8'), stderr: new PassThrough(), kill: () => true }); queueMicrotask(() => { child.stdout.end(mixed); child.stderr.end(); child.emit('close', 0); }); return child; }) as any;
const decodedError = await runWithAbortSignal(undefined, () => registered.execute('fixture', { source: 'xml' }, undefined, undefined, { cwd: '/synthetic' }), { spawn: decodedSpawn }); assert.equal(decodedError.isError, true);
const bytes = Buffer.from(xmlStatus(xmlRecord()));
for (let split = 1; split < bytes.length; split++) assert.equal((await invoke(bytes, {}, { split })).structuredContent.data.items[0].path, '/synthetic/日本-é-😀.txt');
const malformedDto = structuredClone(dto); malformedDto.data.items[0].revisionId = '0'; assert.equal(validateStatusOutput(malformedDto, 2).ok, false); assert.equal((validateStatusOutput(malformedDto, 2) as any).error.code, 'invalid_producer_data');
const wrongCount = structuredClone(dto); wrongCount.data.itemCount.parsed++; assert.equal(validateStatusOutput(wrongCount, 2).ok, false);
const overflow = xmlStatus(Array.from({ length: 100 }, (_, i) => xmlRecord('/synthetic/' + i + 'x'.repeat(1600))).join('')); assert.equal((await invoke(overflow, { maxItems: 100 })).structuredContent.error.code, 'output_overflow');
assert.equal((await invoke(xmlStatus(Array.from({ length: 600 }, (_, i) => xmlRecord('/synthetic/' + i)).join('')), { maxItems: 501 })).isError, true);
// Core XML JSON/text do not trigger version lookups or a second snapshot.
let coreCalls = 0;
const coreSpawn = (() => { coreCalls++; const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true }); queueMicrotask(() => { child.stdout.end(mixed); child.stderr.end(); child.emit('close', 0); }); return child; }) as any;
const core = await runWithAbortSignal(undefined, () => coreStatus.execute({ source: 'xml', format: 'json' }), { spawn: coreSpawn }); assert.equal(JSON.parse(core).data.source.transport, 'status_xml'); assert.equal(coreCalls, 1);
console.log('PASS: strict status XML parser, transport, source selection, native DTO and one-snapshot core presentation');
