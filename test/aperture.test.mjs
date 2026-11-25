import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  apertureRules, dimensionIds, findingTypes, assessmentBinding,
  scoreDimension, evaluateAssessment, readAssessment, renderScorecard,
} from '../lib/aperture.mjs';

const clone = value => structuredClone(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, { plane = 'implementation', stage = 'Production' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'notchlore aperture '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const proof = '# Synthetic scorer fixture\nThis file tests structural availability, not a real product claim.\n';
  await fs.writeFile(path.join(root, 'proof.md'), proof);
  const record = {
    schemaVersion: 1, id: 'A-1', plane, stage,
    scope: { id: 'S-TEST', revision: '1', description: 'Exercise the declared scorer contract in a disposable fixture.' },
    candidate: 'fixture-candidate-1', environment: `node-${process.versions.node}-${process.platform}`,
    reviewer: 'Automated fixture', reviewedAt: '2026-11-24T12:00:00Z',
    authority: { allowed: true, reason: 'Disposable local test fixture.', blockers: [] },
    goals: [{ id: 'G1', outcome: 'Validate the structural assessment rules.', mandatory: true, evidenceIds: ['E1'] }],
    dimensions: [], findings: [], evidence: [], gates: [],
  };
  const binding = assessmentBinding(record);
  record.evidence = [{ id: 'E1', path: 'proof.md', sha256: hash(proof), binding: clone(binding) }];
  record.dimensions = dimensionIds.map(id => ({
    id, status: 'ASSESSED', reviewedTypes: [...findingTypes],
    criteria: [{ id: `C-${id}`, description: `Explicit synthetic criterion for ${id}.`, goalIds: ['G1'] }],
    evidenceIds: ['E1'], binding: clone(binding),
  }));
  record.gates = [{
    id: 'GATE1', goalIds: ['G1'], dimensionIds: [...dimensionIds], mandatory: true, applicable: true,
    result: 'PASS', method: 'Read local synthetic evidence.', expected: 'Evidence is available and bound.',
    workload: 'One small local Markdown fixture.', evidenceIds: ['E1'], binding: clone(binding),
  }];
  return { root, record, proof, evaluate: (input = record, options = {}) => evaluateAssessment(input, { root, ...options }) };
}

function finding(id, dimension, type, options = {}) {
  return {
    id, dimension, criterion: `C-${dimension}`, type, status: 'open',
    description: `A bounded ${type} fixture.`, consequence: 'Tests independent classification.',
    correction: 'Correct this fixture through its declared owner.', owner: 'Fixture reviewer',
    evidenceIds: ['E1'], gateIds: [], ...options,
  };
}

function rebind(record, { evidence = true } = {}) {
  const binding = assessmentBinding(record);
  for (const dimension of record.dimensions) dimension.binding = clone(binding);
  for (const gate of record.gates) gate.binding = clone(binding);
  if (evidence) for (const item of record.evidence) item.binding = clone(binding);
}

test('all 16 independent flag combinations across all 12 dimensions match the exact arithmetic', async t => {
  const f = await fixture(t);
  const independentWeights = { DEF: 4, DIS: 3, EXC: 2, UNC: 1 };
  for (let mask = 0; mask < 16; mask += 1) {
    const record = clone(f.record), chosen = findingTypes.filter((_, index) => mask & 1 << index);
    record.findings = dimensionIds.flatMap(dimension => chosen.map(type => finding(`F-${dimension}-${type}`, dimension, type)));
    const result = await f.evaluate(record);
    assert.equal(result.structuralStatus, 'PASS', JSON.stringify(result.errors));
    for (const dimension of result.dimensions) {
      assert.equal(dimension.score, 10 - chosen.reduce((sum, type) => sum + independentWeights[type], 0), `${mask} ${dimension.id}`);
      assert.deepEqual(dimension.types, chosen);
      assert.equal(dimension.openFindingCount, chosen.length);
    }
    assert.equal(result.findings.length, 12 * chosen.length);
  }
});

test('one type saturates once; closing one versus the last finding changes the deduction correctly', async t => {
  const f = await fixture(t);
  f.record.findings = [finding('F1', 'D04', 'DEF'), finding('F2', 'D04', 'DEF')];
  let result = await f.evaluate();
  assert.equal(result.dimensions[3].score, 6);
  assert.equal(result.dimensions[3].openFindingCount, 2);
  f.record.findings[0].status = 'resolved'; f.record.findings[0].closureEvidenceIds = ['E1'];
  result = await f.evaluate();
  assert.equal(result.dimensions[3].score, 6);
  assert.equal(result.dimensions[3].openFindingCount, 1);
  f.record.findings[1].status = 'resolved'; f.record.findings[1].closureEvidenceIds = ['E1'];
  result = await f.evaluate();
  assert.equal(result.dimensions[3].score, 10);
  assert.equal(result.findings.length, 2);
});

test('accepted and deferred findings remain applicable; distortion creates no cascade', async t => {
  const f = await fixture(t);
  f.record.findings = [finding('F1', 'D07', 'DIS', { status: 'accepted' }), finding('F2', 'D07', 'DIS', { status: 'deferred' })];
  const result = await f.evaluate();
  assert.equal(result.dimensions[6].score, 7);
  assert.deepEqual(result.dimensions[6].types, ['DIS']);
  assert.equal(result.dimensions[6].openFindingCount, 2);
});

test('missing required verifier is DEF; existing but unrun verifier is UNC without duplicate penalties', async t => {
  const f = await fixture(t);
  f.record.gates[0].result = 'NOT RUN'; f.record.gates[0].evidenceIds = []; f.record.gates[0].reason = 'Required verifier does not exist.';
  f.record.findings = [finding('F1', 'D12', 'DEF', { description: 'Required verifier is absent.', gateIds: ['GATE1'] })];
  let result = await f.evaluate();
  assert.equal(result.dimensions[11].score, 6);
  assert.deepEqual(result.dimensions[11].types, ['DEF']);
  assert.equal(result.readiness, 'BLOCKED');
  f.record.findings[0] = finding('F1', 'D12', 'UNC', { description: 'Verifier exists but its required result has not run.', gateIds: ['GATE1'] });
  f.record.gates[0].reason = 'Verifier exists, execution unavailable.';
  result = await f.evaluate();
  assert.equal(result.dimensions[11].score, 9);
  assert.deepEqual(result.dimensions[11].types, ['UNC']);
  assert.equal(result.readiness, 'BLOCKED');
});

test('duplicate and invalid IDs, unknown types and model-assigned scores are rejected', async t => {
  const f = await fixture(t);
  for (const edit of [
    r => { r.findings = [finding('F1', 'D01', 'DIS'), finding('F1', 'D01', 'DIS')]; },
    r => { r.findings = [finding('bad id', 'D01', 'DIS')]; },
    r => { r.findings = [finding('F1', 'D01', 'SEVERE')]; },
    r => { r.findings = [finding('F1', 'D99', 'DIS')]; },
    r => { r.dimensions[0].score = 10; },
    r => { r.dimensions[0].flags = { DEF: 0 }; },
    r => { r.gates.push(clone(r.gates[0])); },
    r => { r.evidence.push(clone(r.evidence[0])); },
    r => { r.goals.push(clone(r.goals[0])); },
    r => { r.dimensions[1].criteria[0].id = 'C-D01'; },
  ]) {
    const record = clone(f.record); edit(record);
    const result = await f.evaluate(record);
    assert.equal(result.structuralStatus, 'FAIL', JSON.stringify(record));
    assert.equal(result.readiness, 'BLOCKED');
  }
  assert.throws(() => scoreDimension([{ type: 'DEF', status: 'open' }]), /unique valid ID/);
});

test('exact 5, 7 and 9 thresholds are per dimension and cannot be averaged away', async t => {
  const f = await fixture(t);
  const cases = [
    ['Prototype', ['DEF', 'UNC'], true], ['Prototype', ['DEF', 'EXC'], false],
    ['MVP', ['DIS'], true], ['MVP', ['DEF'], false],
    ['Production', ['UNC'], true], ['Production', ['EXC'], false],
  ];
  for (const [stage, types, passes] of cases) {
    const record = clone(f.record); record.stage = stage;
    record.findings = types.map(type => finding(`F-${type}`, 'D11', type));
    const result = await f.evaluate(record);
    assert.equal(result.readiness, passes ? 'PASS' : 'BLOCKED', `${stage} ${types}`);
    assert.equal(result.dimensions.filter(d => d.score === 10).length, 11);
  }
});

test('UNKNOWN carries no number; partial four-type coverage invalidates an asserted assessment', async t => {
  const f = await fixture(t);
  const unknown = clone(f.record);
  Object.assign(unknown.dimensions[4], { status: 'UNKNOWN', reviewedTypes: [], evidenceIds: [], reason: 'Lifecycle has not been reviewed.' });
  let result = await f.evaluate(unknown);
  assert.equal(result.structuralStatus, 'PASS');
  assert.equal(result.readiness, 'BLOCKED');
  assert.equal(result.dimensions[4].score, null);
  const partial = clone(f.record); partial.dimensions[4].reviewedTypes.pop();
  result = await f.evaluate(partial);
  assert.equal(result.structuralStatus, 'FAIL');
  assert.equal(result.dimensions[4].status, 'UNKNOWN');
  assert.equal(result.dimensions[4].score, null);
  const absent = clone(f.record); absent.dimensions.pop();
  result = await f.evaluate(absent);
  assert.equal(result.structuralStatus, 'FAIL');
  assert.equal(result.dimensions[11].score, null);
});

test('N/A needs scoped justification and cannot hide active findings or applicable mandatory gates', async t => {
  const f = await fixture(t);
  const record = clone(f.record);
  Object.assign(record.dimensions[2], { status: 'N/A', reviewedTypes: [], reason: 'This synthetic arithmetic check makes no financial or contractual promise.' });
  record.gates[0].dimensionIds = record.gates[0].dimensionIds.filter(id => id !== 'D03');
  let result = await f.evaluate(record);
  assert.equal(result.structuralStatus, 'PASS'); assert.equal(result.readiness, 'PASS');
  assert.equal(result.dimensions[2].score, null); assert.equal(result.dimensions[2].status, 'N/A');
  const missingReason = clone(record); delete missingReason.dimensions[2].reason;
  assert.equal((await f.evaluate(missingReason)).structuralStatus, 'FAIL');
  record.findings = [finding('F1', 'D03', 'DEF')];
  assert.equal((await f.evaluate(record)).structuralStatus, 'FAIL');
  record.findings = []; record.gates[0].dimensionIds.push('D03');
  assert.equal((await f.evaluate(record)).structuralStatus, 'FAIL');
});

test('score 9 with mandatory security NOT RUN remains blocked', async t => {
  const f = await fixture(t);
  f.record.findings = [finding('F-SEC', 'D06', 'UNC', { gateIds: ['G-SEC'] })];
  f.record.gates.push({ ...clone(f.record.gates[0]), id: 'G-SEC', dimensionIds: ['D06'], result: 'NOT RUN', evidenceIds: [], reason: 'Required security execution unavailable.' });
  const result = await f.evaluate();
  assert.equal(result.structuralStatus, 'PASS');
  assert.equal(result.dimensions[5].score, 9);
  assert.equal(result.readiness, 'BLOCKED');
  assert.equal(result.gates.find(g => g.id === 'G-SEC').passed, false);
  assert.match(renderScorecard(result), /G-SEC NOT RUN \[unpassed\]/);
});

test('every nonpassing mandatory outcome vetoes readiness independently of the score', async t => {
  const f = await fixture(t);
  for (const status of ['FAIL', 'BLOCKED', 'NOT RUN', 'INCONCLUSIVE']) {
    const record = clone(f.record); record.gates[0].result = status; record.gates[0].reason = 'Declared required check has not passed.';
    const result = await f.evaluate(record);
    assert.equal(result.structuralStatus, 'PASS');
    assert.equal(result.readiness, 'BLOCKED');
    assert.ok(result.dimensions.every(d => d.score === 10));
  }
});

test('mandatory missing feature blocks even a numerically eligible prototype', async t => {
  const f = await fixture(t, { stage: 'Prototype' });
  f.record.findings = [finding('F1', 'D04', 'DEF', { gateIds: ['GATE1'] })];
  f.record.gates[0].result = 'FAIL'; f.record.gates[0].reason = 'The promised useful feature is absent.';
  let result = await f.evaluate();
  assert.equal(result.dimensions[3].score, 6); assert.equal(result.readiness, 'BLOCKED');
  f.record.gates[0].result = 'PASS'; delete f.record.gates[0].reason;
  result = await f.evaluate();
  assert.equal(result.structuralStatus, 'FAIL');
  assert.ok(result.errors.some(item => item.code === 'GATE_CONFLICT'));
});

test('a ready design and an unrun implementation remain distinct assessments', async t => {
  const design = await fixture(t, { plane: 'documentation' });
  assert.equal((await design.evaluate()).readiness, 'PASS');
  const runtime = clone(design.record); runtime.id = 'A-RUNTIME'; runtime.plane = 'implementation'; rebind(runtime);
  for (const dimension of runtime.dimensions) Object.assign(dimension, { status: 'UNKNOWN', reviewedTypes: [], evidenceIds: [], reason: 'Runtime assessment has not begun.' });
  runtime.gates[0].result = 'NOT RUN'; runtime.gates[0].evidenceIds = []; runtime.gates[0].reason = 'Execution is a later authorized build.';
  const result = await design.evaluate(runtime);
  assert.equal(result.structuralStatus, 'PASS'); assert.equal(result.readiness, 'NOT RUN');
  assert.ok(result.dimensions.every(item => item.score === null));
  assert.equal((await design.evaluate()).readiness, 'PASS');
});

test('stale candidate, environment, scope and external expected binding return UNKNOWN', async t => {
  const f = await fixture(t);
  for (const [key, value] of [['candidate', 'candidate-2'], ['environment', 'another-host'], ['scopeRevision', '2'], ['scopeId', 'OTHER'], ['plane', 'documentation']]) {
    const record = clone(f.record); record.evidence[0].binding[key] = value;
    let result = await f.evaluate(record);
    assert.equal(result.structuralStatus, 'FAIL'); assert.ok(result.dimensions.every(item => item.score === null));
    result = await f.evaluate(f.record, { expectedBinding: { [key]: value } });
    assert.equal(result.structuralStatus, 'FAIL'); assert.ok(result.dimensions.every(item => item.status === 'UNKNOWN'));
  }
});

test('reuse of unchanged proof needs explicit dated validity and cannot cross environment or plane', async t => {
  const f = await fixture(t);
  const record = clone(f.record); record.candidate = 'fixture-candidate-2'; rebind(record, { evidence: false });
  let result = await f.evaluate(record); assert.equal(result.structuralStatus, 'FAIL');
  record.evidence[0].reuse = { forBinding: assessmentBinding(record), reason: 'Only an unrelated explanatory comment changed; this criterion and proof remain applicable.', reviewedBy: 'Fixture reviewer', reviewedAt: '2026-11-24T12:05:00Z' };
  result = await f.evaluate(record); assert.equal(result.structuralStatus, 'PASS', JSON.stringify(result.errors)); assert.equal(result.readiness, 'PASS');
  record.evidence[0].binding.environment = 'unqualified-platform';
  result = await f.evaluate(record); assert.equal(result.structuralStatus, 'FAIL');
  record.evidence[0].binding.environment = record.environment; record.evidence[0].binding.plane = 'documentation';
  assert.equal((await f.evaluate(record)).structuralStatus, 'FAIL');
});

test('missing, changed, escaped and symlinked evidence is rejected without mutating files', async t => {
  const f = await fixture(t);
  const outside = path.join(path.dirname(f.root), `${path.basename(f.root)}-outside.md`);
  await fs.writeFile(outside, f.proof); t.after(() => fs.rm(outside, { force: true }));
  for (const evidencePath of ['missing.md', '../outside.md', '/etc/passwd', 'C:\\secrets.txt', 'a/../proof.md', 'proof.md\0tail', 'https://example.com/proof']) {
    const record = clone(f.record); record.evidence[0].path = evidencePath;
    assert.equal((await f.evaluate(record)).structuralStatus, 'FAIL');
  }
  await fs.symlink(outside, path.join(f.root, 'link.md'));
  const linked = clone(f.record); linked.evidence[0].path = 'link.md';
  assert.equal((await f.evaluate(linked)).structuralStatus, 'FAIL');
  const directory = clone(f.record); directory.evidence[0].path = 'folder'; await fs.mkdir(path.join(f.root, 'folder'));
  assert.equal((await f.evaluate(directory)).structuralStatus, 'FAIL');
  await fs.writeFile(path.join(f.root, 'proof.md'), `${f.proof}Changed.`);
  const result = await f.evaluate(); assert.equal(result.structuralStatus, 'FAIL');
  assert.equal(await fs.readFile(outside, 'utf8'), f.proof);
});

test('required references, gate PASS evidence and closure evidence are checked', async t => {
  const f = await fixture(t);
  for (const edit of [
    r => { r.dimensions[0].evidenceIds = []; },
    r => { r.dimensions[0].evidenceIds = ['MISSING']; },
    r => { r.dimensions[0].criteria[0].goalIds = ['MISSING']; },
    r => { r.gates[0].evidenceIds = []; },
    r => { r.gates[0].goalIds = ['MISSING']; },
    r => { r.findings = [finding('F1', 'D02', 'DEF', { criterion: 'C-D01' })]; },
    r => { r.findings = [finding('F1', 'D02', 'DEF', { status: 'resolved' })]; },
    r => { r.findings = [finding('F1', 'D02', 'DEF', { gateIds: ['MISSING'] })]; },
    r => { r.gates = []; },
  ]) {
    const record = clone(f.record); edit(record);
    assert.equal((await f.evaluate(record)).structuralStatus, 'FAIL');
  }
});

test('independent cross-dimension effects retain shared cause links and all findings', async t => {
  const f = await fixture(t);
  f.record.findings = [
    finding('F-AUTH', 'D06', 'DIS', { causeId: 'CAUSE-OWNER', description: 'Wrong owner can read protected resource.' }),
    finding('F-CONTRACT', 'D08', 'DEF', { causeId: 'CAUSE-OWNER', description: 'Required actor identity field is absent from the contract.' }),
  ];
  const result = await f.evaluate();
  assert.equal(result.dimensions[5].score, 7); assert.equal(result.dimensions[7].score, 6);
  assert.equal(result.findings.length, 2);
  assert.ok(result.findings.every(item => item.causeId === 'CAUSE-OWNER'));
  assert.match(renderScorecard(result), /F-AUTH/); assert.match(renderScorecard(result), /F-CONTRACT/);
});

test('scope changes need new ID/revision, explicit authority and retained history', async t => {
  const f = await fixture(t);
  const previous = clone(f.record); previous.findings = [finding('F1', 'D04', 'DEF')];
  const retainedBytes = JSON.stringify(previous);
  const current = clone(previous); current.id = 'A-2'; current.scope.revision = '2';
  current.scope.description = 'An explicitly authorized narrower synthetic slice; retain omitted feature in history.';
  current.findings[0].status = 'out_of_scope'; current.findings[0].scopeChangeId = current.id;
  rebind(current);
  let result = await f.evaluate(current, { previousAssessment: previous });
  assert.equal(result.structuralStatus, 'FAIL');
  current.scopeChange = {
    previousAssessmentId: previous.id, authorizedBy: 'Fixture owner', rationale: 'Owner explicitly defers this feature with documented consequences.',
    before: { scopeRevision: previous.scope.revision, stage: previous.stage }, after: { scopeRevision: current.scope.revision, stage: current.stage },
  };
  result = await f.evaluate(current, { previousAssessment: previous });
  assert.equal(result.structuralStatus, 'PASS', JSON.stringify(result.errors)); assert.equal(result.readiness, 'PASS');
  assert.equal(result.findings[0].status, 'out_of_scope'); assert.equal(result.dimensions[3].score, 10);
  assert.equal(JSON.stringify(previous), retainedBytes);
  assert.equal((await f.evaluate(current)).structuralStatus, 'FAIL');
  const erased = clone(current); erased.findings = [];
  assert.equal((await f.evaluate(erased, { previousAssessment: previous })).structuralStatus, 'FAIL');
  const reusedId = clone(current); reusedId.id = previous.id;
  assert.equal((await f.evaluate(reusedId, { previousAssessment: previous })).structuralStatus, 'FAIL');
});

test('silent stage lowering, new N/A or mandatory-gate weakening is rejected on reassessment', async t => {
  const f = await fixture(t);
  for (const edit of [
    r => { r.stage = 'Prototype'; },
    r => { r.gates[0].mandatory = false; r.goals[0].mandatory = false; },
    r => { r.dimensions[0].status = 'N/A'; r.dimensions[0].reviewedTypes = []; r.dimensions[0].reason = 'New applicability claim.'; r.gates[0].dimensionIds.shift(); },
    r => { r.gates[0].expected = 'A weaker expected outcome.'; },
  ]) {
    const record = clone(f.record); record.id = 'A-2'; edit(record);
    const result = await f.evaluate(record, { previousAssessment: f.record });
    assert.equal(result.structuralStatus, 'FAIL');
    assert.ok(result.errors.some(item => item.code === 'SCOPE'));
  }
});

test('no-op scope-change declaration cannot erase an applicable deduction', async t => {
  const f = await fixture(t);
  const previous = clone(f.record); previous.findings = [finding('F1', 'D12', 'UNC')];
  const current = clone(previous); current.id = 'A-2';
  current.findings[0].status = 'out_of_scope'; current.findings[0].scopeChangeId = current.id;
  current.scopeChange = {
    previousAssessmentId: previous.id, authorizedBy: 'Fixture owner', rationale: 'A no-op scope change is insufficient.',
    before: { scopeRevision: '1', stage: 'Production' }, after: { scopeRevision: '1', stage: 'Production' },
  };
  const result = await f.evaluate(current, { previousAssessment: previous });
  assert.equal(result.structuralStatus, 'FAIL'); assert.equal(result.readiness, 'BLOCKED');
  assert.ok(result.errors.some(item => item.code === 'SCOPE' && item.message.includes('advance')));
  assert.equal(result.dimensions[11].status, 'UNKNOWN');
  assert.equal(result.dimensions[11].score, null);
});

test('aggregate evidence reads are bounded with an explicit failure rather than silently dropped files', async t => {
  const f = await fixture(t), bytes = Buffer.alloc(16 * 1024 * 1024, 120);
  await fs.writeFile(path.join(f.root, 'large.bin'), bytes);
  f.record.evidence = Array.from({ length: 5 }, (_, index) => ({
    id: `E${index + 1}`, path: 'large.bin', sha256: hash(bytes), binding: assessmentBinding(f.record),
  }));
  const result = await f.evaluate();
  assert.equal(result.structuralStatus, 'FAIL');
  assert.ok(result.errors.some(item => item.message.includes('Combined evidence exceeds')));
  assert.equal(result.readiness, 'BLOCKED');
});

test('reordering declarations and closing findings does not invent a scope change', async t => {
  const f = await fixture(t);
  f.record.findings = [finding('F1', 'D04', 'UNC')];
  const current = clone(f.record); current.id = 'A-2'; current.dimensions.reverse(); current.gates[0].dimensionIds.reverse();
  current.findings[0].status = 'resolved'; current.findings[0].closureEvidenceIds = ['E1'];
  const result = await f.evaluate(current, { previousAssessment: f.record });
  assert.equal(result.structuralStatus, 'PASS', JSON.stringify(result.errors)); assert.equal(result.readiness, 'PASS');
});

test('authority and nonwaivable obligations block even perfect scores', async t => {
  const f = await fixture(t);
  f.record.authority.allowed = false; f.record.authority.reason = 'Deployment authority has not been granted.';
  let result = await f.evaluate(); assert.equal(result.readiness, 'BLOCKED'); assert.equal(result.structuralStatus, 'PASS');
  f.record.authority.allowed = true; f.record.authority.blockers = ['Applicable privacy obligation is unresolved.'];
  result = await f.evaluate(); assert.equal(result.readiness, 'BLOCKED'); assert.ok(result.dimensions.every(d => d.score === 10));
});

test('optional failed gates stay visible without inventing a mandatory veto', async t => {
  const f = await fixture(t);
  f.record.gates.push({ ...clone(f.record.gates[0]), id: 'OPTIONAL', mandatory: false, result: 'FAIL', reason: 'Deferred optional investigation.' });
  const result = await f.evaluate();
  assert.equal(result.readiness, 'PASS'); assert.equal(result.gates[1].result, 'FAIL');
  assert.match(renderScorecard(result), /OPTIONAL.*FAIL.*optional/);
});

test('a gate can be inapplicable only with a matching N/A result, scope reason and evidence', async t => {
  const f = await fixture(t);
  f.record.gates.push({ ...clone(f.record.gates[0]), id: 'REMOTE', applicable: false, result: 'N/A', reason: 'This package does not ship remote supervision.' });
  assert.equal((await f.evaluate()).readiness, 'PASS');
  f.record.gates[1].result = 'PASS';
  assert.equal((await f.evaluate()).structuralStatus, 'FAIL');
});

test('JSON file entry is read-only and malformed JSON is rejected', async t => {
  const f = await fixture(t), file = path.join(f.root, 'assessment.json');
  const bytes = JSON.stringify(f.record, null, 2); await fs.writeFile(file, bytes);
  const result = await readAssessment(file, { root: f.root });
  assert.equal(result.readiness, 'PASS'); assert.equal(await fs.readFile(file, 'utf8'), bytes);
  await fs.writeFile(file, '{broken'); await assert.rejects(readAssessment(file, { root: f.root }), /valid JSON/);
});

test('malformed objects fail structurally without uncontrolled parser crashes', async t => {
  const f = await fixture(t);
  for (const input of [null, {}, [], { ...clone(f.record), gates: [{ id: 'BROKEN', mandatory: true, applicable: true }] },
    { ...clone(f.record), dimensions: [null] }, { ...clone(f.record), authority: null },
    { ...clone(f.record), findings: [finding('F1', 'D12', 'UNC', { evidenceIds: 'E1' })] }]) {
    const result = await f.evaluate(input);
    assert.equal(result.structuralStatus, 'FAIL'); assert.equal(result.readiness, 'BLOCKED');
    assert.doesNotThrow(() => renderScorecard(result));
  }
});

test('machine policy remains immutable and contains the selected twelve-dimension contract', () => {
  assert.equal(dimensionIds.length, 12);
  assert.deepEqual(dimensionIds, Array.from({ length: 12 }, (_, index) => `D${String(index + 1).padStart(2, '0')}`));
  assert.deepEqual(apertureRules.stages, { Prototype: 5, MVP: 7, Production: 9 });
  assert.throws(() => { apertureRules.types.DEF.deduction = 1; }, TypeError);
});
