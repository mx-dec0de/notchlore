import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import path from 'node:path';

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const apertureRules = freeze(JSON.parse(readFileSync(
  new URL('../skills/notchlore/references/aperture-rules.json', import.meta.url), 'utf8')));
export const dimensionIds = Object.freeze(apertureRules.dimensions.map(item => item.id));
export const findingTypes = Object.freeze(Object.keys(apertureRules.types));
export const apertureLimits = Object.freeze({ assessmentBytes: 4 * 1024 * 1024, evidenceFileBytes: 16 * 1024 * 1024, evidenceTotalBytes: 64 * 1024 * 1024 });
const activeStatuses = new Set(['open', 'accepted', 'deferred']);
const findingStatuses = new Set([...activeStatuses, 'resolved', 'out_of_scope']);
const gateResults = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT RUN', 'INCONCLUSIVE', 'N/A']);
const bindingKeys = ['plane', 'scopeId', 'scopeRevision', 'candidate', 'environment'];
const identifier = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const equalBinding = (left, right) => bindingKeys.every(key => left?.[key] === right?.[key]);

export function assessmentBinding(record) {
  return {
    plane: record.plane, scopeId: record.scope?.id, scopeRevision: record.scope?.revision,
    candidate: record.candidate, environment: record.environment,
  };
}

// This arithmetic helper alone is not an assessment or a readiness check.
export function scoreDimension(findings) {
  if (!Array.isArray(findings)) throw new Error('Findings must be an array.');
  const ids = new Set(), types = new Set();
  let count = 0;
  for (const finding of findings) {
    if (!isObject(finding) || typeof finding.id !== 'string' || !identifier.test(finding.id) || ids.has(finding.id)) {
      throw new Error('Each finding requires a unique valid ID.');
    }
    ids.add(finding.id);
    if (!Object.hasOwn(apertureRules.types, finding.type)) throw new Error(`Unknown finding type: ${finding.type}`);
    if (!findingStatuses.has(finding.status)) throw new Error(`Unknown finding status: ${finding.status}`);
    if (activeStatuses.has(finding.status)) { types.add(finding.type); count += 1; }
  }
  const ordered = findingTypes.filter(type => types.has(type));
  return {
    score: 10 - ordered.reduce((sum, type) => sum + apertureRules.types[type].deduction, 0),
    types: ordered, openFindingCount: count,
  };
}

async function evidenceDigest(root, relative, remaining) {
  if (!nonempty(relative) || relative.includes('\\') || /[\x00-\x1f\x7f]/.test(relative) || relative.includes(':') ||
      path.posix.isAbsolute(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Evidence path must be a normalized relative local file path.');
  }
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error('Evidence paths cannot contain symlinks.');
  }
  const handle = await fs.open(current, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Evidence must be a regular file.');
    if (stat.size > apertureLimits.evidenceFileBytes) throw new Error('Evidence file exceeds 16 MiB; use a bounded result and digest reference.');
    if (stat.size > remaining) throw new Error('Combined evidence exceeds the 64 MiB validation budget; no evidence was silently truncated.');
    const maximum = Math.min(apertureLimits.evidenceFileBytes, remaining), hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, maximum - size + 1), null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maximum) throw new Error('Evidence grew beyond its validation budget while being read.');
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) {
      throw new Error('Evidence changed during validation; capture a stable candidate and retry.');
    }
    return { sha256: hash.digest('hex'), size };
  } finally { await handle.close(); }
}

export async function evaluateAssessment(record, { root = process.cwd(), expectedBinding = {}, previousAssessment } = {}) {
  const errors = [], blocked = [], invalidDimensions = new Set(), invalidEvidence = new Set(), invalidGoals = new Set();
  const error = (code, at, message) => errors.push({ code, path: at, message });
  const require = (condition, code, at, message) => { if (!condition) error(code, at, message); return Boolean(condition); };
  const object = (value, at) => require(isObject(value), 'OBJECT', at, 'Expected an object.');
  const text = (value, at) => require(nonempty(value), 'TEXT', at, 'Expected nonempty text.');
  const id = (value, at) => require(typeof value === 'string' && identifier.test(value), 'ID', at, 'Invalid identifier.');
  const array = (value, at) => { require(Array.isArray(value), 'ARRAY', at, 'Expected an array.'); return Array.isArray(value) ? value : []; };
  const bool = (value, at) => require(typeof value === 'boolean', 'BOOLEAN', at, 'Expected a boolean.');
  const unknownKeys = (value, allowed, at) => {
    if (isObject(value)) for (const key of Object.keys(value)) {
      require(allowed.includes(key), 'FIELD', `${at}.${key}`, 'Unknown field; scores and type flags must be derived.');
    }
  };
  const list = (value, at) => {
    const items = array(value, at), seen = new Set();
    for (let i = 0; i < items.length; i += 1) {
      id(items[i], `${at}[${i}]`);
      require(!seen.has(items[i]), 'DUPLICATE', `${at}[${i}]`, 'Duplicate reference.');
      seen.add(items[i]);
    }
    return items;
  };
  const index = (value, at) => {
    const entries = array(value, at), indexed = new Map();
    for (let i = 0; i < entries.length; i += 1) {
      const item = entries[i];
      if (!object(item, `${at}[${i}]`)) continue;
      id(item.id, `${at}[${i}].id`);
      require(!indexed.has(item.id), 'DUPLICATE', `${at}[${i}].id`, `Duplicate ID: ${item.id}`);
      indexed.set(item.id, item);
    }
    return indexed;
  };
  const checkRefs = (value, target, at, { required = false } = {}) => {
    const refs = list(value, at);
    if (required) require(refs.length > 0, 'REFERENCE', at, 'At least one evidence or criterion reference is required.');
    for (const ref of refs) require(target.has(ref), 'REFERENCE', at, `Unknown reference: ${ref}`);
    return refs;
  };
  if (!object(record, 'assessment')) return { structuralStatus: 'FAIL', readiness: 'BLOCKED', errors, dimensions: [], findings: [], gates: [] };
  unknownKeys(record, ['schemaVersion', 'id', 'plane', 'stage', 'scope', 'candidate', 'environment', 'reviewer', 'reviewedAt',
    'authority', 'goals', 'dimensions', 'findings', 'evidence', 'gates', 'scopeChange'], 'assessment');
  require(record.schemaVersion === 1, 'SCHEMA', 'schemaVersion', 'Expected schemaVersion 1.');
  id(record.id, 'id');
  require(['documentation', 'implementation'].includes(record.plane), 'PLANE', 'plane', 'Choose documentation or implementation.');
  require(Object.hasOwn(apertureRules.stages, record.stage), 'STAGE', 'stage', 'Unknown maturity stage.');
  object(record.scope, 'scope');
  unknownKeys(record.scope, ['id', 'revision', 'description'], 'scope');
  id(record.scope?.id, 'scope.id'); text(record.scope?.revision, 'scope.revision'); text(record.scope?.description, 'scope.description');
  for (const key of ['candidate', 'environment', 'reviewer']) text(record[key], key);
  require(typeof record.reviewedAt === 'string' && Number.isFinite(Date.parse(record.reviewedAt)) && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(record.reviewedAt),
    'DATE', 'reviewedAt', 'Use a valid ISO timestamp with timezone.');
  const binding = assessmentBinding(record);
  const bindingValid = (value, at) => {
    if (!object(value, at)) return false;
    unknownKeys(value, bindingKeys, at);
    let valid = true;
    for (const key of bindingKeys) if (!text(value[key], `${at}.${key}`)) valid = false;
    return valid;
  };
  const currentBinding = (value, at) => {
    const valid = bindingValid(value, at) && equalBinding(value, binding);
    if (!valid) error('STALE', at, 'Binding does not match this plane, scope, candidate and environment.');
    return valid;
  };
  for (const [key, value] of Object.entries(expectedBinding)) {
    require(bindingKeys.includes(key), 'BINDING', `expectedBinding.${key}`, 'Unknown binding key.');
    if (!require(binding[key] === value, 'STALE', key, 'Assessment differs from the independently supplied current binding.')) {
      for (const dimension of dimensionIds) invalidDimensions.add(dimension);
    }
  }
  object(record.authority, 'authority');
  unknownKeys(record.authority, ['allowed', 'reason', 'blockers'], 'authority');
  bool(record.authority?.allowed, 'authority.allowed'); text(record.authority?.reason, 'authority.reason');
  const authorityBlockers = array(record.authority?.blockers, 'authority.blockers');
  authorityBlockers.forEach((item, i) => text(item, `authority.blockers[${i}]`));
  if (record.authority?.allowed !== true) blocked.push('Authority does not permit this action.');
  for (const item of authorityBlockers) blocked.push(`Authority/obligation: ${item}`);

  const evidence = index(record.evidence, 'evidence'), goals = index(record.goals, 'goals');
  const dimensions = index(record.dimensions, 'dimensions'), findings = index(record.findings, 'findings'), gates = index(record.gates, 'gates');
  const requiredGoals = new Set([...gates.values()].filter(gate => gate.mandatory === true && gate.applicable === true)
    .flatMap(gate => Array.isArray(gate.goalIds) ? gate.goalIds : []));
  let actualRoot;
  try { actualRoot = await fs.realpath(root); }
  catch { error('ROOT', 'root', 'Evidence root is not an accessible directory.'); }
  let evidenceReadBytes = 0;
  for (const [evidenceId, item] of evidence) {
    const at = `evidence.${evidenceId}`, before = errors.length;
    unknownKeys(item, ['id', 'path', 'sha256', 'binding', 'reuse'], at);
    text(item.path, `${at}.path`);
    require(typeof item.sha256 === 'string' && digestPattern.test(item.sha256), 'HASH', `${at}.sha256`, 'Expected a lowercase SHA-256 digest.');
    const ownBindingValid = bindingValid(item.binding, `${at}.binding`);
    if (ownBindingValid && !equalBinding(item.binding, binding)) {
      const reuse = item.reuse;
      if (object(reuse, `${at}.reuse`)) {
        unknownKeys(reuse, ['forBinding', 'reason', 'reviewedBy', 'reviewedAt'], `${at}.reuse`);
        currentBinding(reuse.forBinding, `${at}.reuse.forBinding`);
        text(reuse.reason, `${at}.reuse.reason`); text(reuse.reviewedBy, `${at}.reuse.reviewedBy`);
        require(typeof reuse.reviewedAt === 'string' && Number.isFinite(Date.parse(reuse.reviewedAt)), 'DATE', `${at}.reuse.reviewedAt`, 'Reuse requires a dated review.');
        require(['plane', 'environment', 'scopeId'].every(key => item.binding[key] === binding[key]), 'STALE', at,
          'Reuse cannot turn evidence from another plane, scope or environment into current proof.');
      } else error('STALE', at, 'Evidence from a previous candidate or scope revision needs an explicit validity basis.');
    } else if (item.reuse !== undefined) {
      error('REUSE', `${at}.reuse`, 'A reuse declaration is only for evidence from a different candidate or scope revision.');
    }
    if (actualRoot) {
      try {
        const observed = await evidenceDigest(actualRoot, item.path, apertureLimits.evidenceTotalBytes - evidenceReadBytes);
        evidenceReadBytes += observed.size;
        require(observed.sha256 === item.sha256, 'HASH', at, 'Evidence bytes do not match their declared digest.');
      } catch (cause) { error('EVIDENCE', at, cause.code === 'ENOENT' ? 'Evidence file is missing.' : cause.message); }
    }
    if (errors.length !== before || !actualRoot) invalidEvidence.add(evidenceId);
  }
  for (const [goalId, goal] of goals) {
    const at = `goals.${goalId}`, before = errors.length;
    unknownKeys(goal, ['id', 'outcome', 'mandatory', 'evidenceIds'], at);
    text(goal.outcome, `${at}.outcome`); bool(goal.mandatory, `${at}.mandatory`);
    const refs = checkRefs(goal.evidenceIds, evidence, `${at}.evidenceIds`, { required: true });
    if (goal.mandatory === true) require(requiredGoals.has(goalId),
      'GATE', at, 'A mandatory goal must have an applicable mandatory gate.');
    if (errors.length !== before || refs.some(ref => invalidEvidence.has(ref))) invalidGoals.add(goalId);
  }
  require(goals.size > 0, 'GOAL', 'goals', 'An assessment needs at least one declared goal.');
  const criteria = new Map();
  for (const expected of dimensionIds) require(dimensions.has(expected), 'COVERAGE', 'dimensions', `Missing dimension: ${expected}`);
  for (const [dimensionId, dimension] of dimensions) {
    const at = `dimensions.${dimensionId}`, before = errors.length;
    unknownKeys(dimension, ['id', 'status', 'reason', 'reviewedTypes', 'criteria', 'evidenceIds', 'binding'], at);
    require(dimensionIds.includes(dimensionId), 'DIMENSION', at, 'Unknown dimension ID.');
    require(['ASSESSED', 'UNKNOWN', 'N/A'].includes(dimension.status), 'ASSESSMENT', `${at}.status`, 'Unknown assessment status.');
    currentBinding(dimension.binding, `${at}.binding`);
    const refs = checkRefs(dimension.evidenceIds, evidence, `${at}.evidenceIds`, { required: dimension.status !== 'UNKNOWN' });
    if (refs.some(ref => invalidEvidence.has(ref))) invalidDimensions.add(dimensionId);
    const reviewed = list(dimension.reviewedTypes, `${at}.reviewedTypes`);
    for (const type of reviewed) require(findingTypes.includes(type), 'TYPE', `${at}.reviewedTypes`, 'Unknown reviewed type.');
    if (dimension.status === 'ASSESSED') {
      require(findingTypes.every(type => reviewed.includes(type)), 'COVERAGE', `${at}.reviewedTypes`, 'All four types must be reviewed before assigning a score.');
    } else text(dimension.reason, `${at}.reason`);
    if (dimension.status === 'N/A') require(reviewed.length === 0, 'APPLICABILITY', at, 'N/A cannot contain a scored review.');
    const entries = array(dimension.criteria, `${at}.criteria`);
    if (dimension.status === 'ASSESSED') require(entries.length > 0, 'CRITERION', `${at}.criteria`, 'An assessed dimension needs scoped criteria.');
    for (const criterion of entries) {
      if (!object(criterion, `${at}.criteria`)) continue;
      unknownKeys(criterion, ['id', 'description', 'goalIds'], `${at}.criteria`);
      id(criterion.id, `${at}.criteria.id`); text(criterion.description, `${at}.criteria.description`);
      require(!criteria.has(criterion.id), 'DUPLICATE', `${at}.criteria.id`, 'Criterion IDs must be unique across dimensions.');
      const linkedGoals = checkRefs(criterion.goalIds, goals, `${at}.criteria.goalIds`, { required: true });
      if (linkedGoals.some(ref => invalidGoals.has(ref))) invalidDimensions.add(dimensionId);
      criteria.set(criterion.id, { ...criterion, dimension: dimensionId });
    }
    if (errors.length !== before) invalidDimensions.add(dimensionId);
  }
  for (const [findingId, finding] of findings) {
    const at = `findings.${findingId}`, before = errors.length;
    id(finding.id, `${at}.id`);
    unknownKeys(finding, ['id', 'dimension', 'criterion', 'type', 'status', 'description', 'consequence', 'correction', 'owner',
      'evidenceIds', 'unknown', 'gateIds', 'closureEvidenceIds', 'causeId', 'scopeChangeId'], at);
    require(dimensionIds.includes(finding.dimension), 'DIMENSION', `${at}.dimension`, 'Unknown finding dimension.');
    require(criteria.get(finding.criterion)?.dimension === finding.dimension, 'CRITERION', `${at}.criterion`, 'Criterion must exist in the affected dimension.');
    require(Object.hasOwn(apertureRules.types, finding.type), 'TYPE', `${at}.type`, 'Unknown primary type.');
    require(findingStatuses.has(finding.status), 'STATUS', `${at}.status`, 'Unknown finding status.');
    for (const key of ['description', 'consequence', 'correction', 'owner']) text(finding[key], `${at}.${key}`);
    const refs = checkRefs(finding.evidenceIds, evidence, `${at}.evidenceIds`);
    require(refs.length > 0 || nonempty(finding.unknown), 'REFERENCE', at, 'Finding needs evidence or a precise unknown.');
    if (finding.unknown !== undefined) text(finding.unknown, `${at}.unknown`);
    checkRefs(finding.gateIds, gates, `${at}.gateIds`);
    if (finding.causeId !== undefined) id(finding.causeId, `${at}.causeId`);
    if (finding.status === 'resolved') {
      const closure = checkRefs(finding.closureEvidenceIds, evidence, `${at}.closureEvidenceIds`, { required: true });
      if (closure.some(ref => invalidEvidence.has(ref))) invalidDimensions.add(finding.dimension);
    } else if (finding.closureEvidenceIds !== undefined) checkRefs(finding.closureEvidenceIds, evidence, `${at}.closureEvidenceIds`);
    if (finding.status === 'out_of_scope') {
      require(record.scopeChange && finding.scopeChangeId === record.id, 'SCOPE', at, 'Removing an applicable finding needs this explicit authorized scope revision.');
    }
    if (activeStatuses.has(finding.status) && dimensions.get(finding.dimension)?.status === 'N/A') {
      error('APPLICABILITY', at, 'An active finding cannot be hidden in an N/A dimension.');
    }
    if (refs.some(ref => invalidEvidence.has(ref)) || errors.length !== before) invalidDimensions.add(finding.dimension);
  }

  const gateViews = [], gateViewById = new Map();
  for (const [gateId, gate] of gates) {
    const at = `gates.${gateId}`, before = errors.length;
    unknownKeys(gate, ['id', 'goalIds', 'dimensionIds', 'mandatory', 'applicable', 'result', 'method', 'expected', 'workload',
      'evidenceIds', 'binding', 'reason'], at);
    bool(gate.mandatory, `${at}.mandatory`); bool(gate.applicable, `${at}.applicable`);
    require(gateResults.has(gate.result), 'RESULT', `${at}.result`, 'Unknown gate result.');
    const linkedGoals = checkRefs(gate.goalIds, goals, `${at}.goalIds`, { required: true });
    const affected = checkRefs(gate.dimensionIds, new Map(dimensionIds.map(value => [value, true])), `${at}.dimensionIds`, { required: true });
    for (const key of ['method', 'expected', 'workload']) text(gate[key], `${at}.${key}`);
    const refs = checkRefs(gate.evidenceIds, evidence, `${at}.evidenceIds`, { required: gate.result === 'PASS' || gate.applicable === false });
    currentBinding(gate.binding, `${at}.binding`);
    if (gate.result !== 'PASS' || gate.applicable === false) text(gate.reason, `${at}.reason`);
    require(gate.applicable === false ? gate.result === 'N/A' : gate.result !== 'N/A', 'APPLICABILITY', at,
      'N/A requires an explicitly inapplicable gate and a scoped reason.');
    if (gate.applicable === true) for (const affectedId of affected) {
      require(dimensions.get(affectedId)?.status !== 'N/A', 'APPLICABILITY', at, 'An applicable gate cannot rely on an N/A dimension.');
    }
    const valid = errors.length === before && !refs.some(ref => invalidEvidence.has(ref)) && !linkedGoals.some(ref => invalidGoals.has(ref));
    if (!valid) for (const affectedId of affected) invalidDimensions.add(affectedId);
    const passed = gate.applicable === false && valid || gate.result === 'PASS' && valid;
    const view = { ...structuredClone(gate), goalIds: linkedGoals, dimensionIds: affected, evidenceIds: refs, evidenceValid: valid, passed };
    gateViews.push(view); gateViewById.set(gateId, view);
    if (gate.mandatory === true && gate.applicable === true && !passed) blocked.push(`Mandatory gate ${gateId}: ${gate.result}${valid ? '' : ' (invalid evidence)'}.`);
  }
  for (const finding of findings.values()) if (activeStatuses.has(finding.status)) {
    for (const gateId of Array.isArray(finding.gateIds) ? finding.gateIds : []) {
      const gate = gateViewById.get(gateId);
      if (gate?.mandatory && gate.applicable && gate.result === 'PASS') {
        error('GATE_CONFLICT', `findings.${finding.id}`, `Active finding conflicts with mandatory PASS gate ${gateId}.`);
        gate.passed = false;
        invalidDimensions.add(finding.dimension);
        blocked.push(`Mandatory gate ${gateId}: unresolved linked finding ${finding.id}.`);
      }
    }
  }

  const scopeChange = record.scopeChange;
  const historyErrorStart = errors.length;
  if (scopeChange !== undefined) {
    object(scopeChange, 'scopeChange');
    unknownKeys(scopeChange, ['previousAssessmentId', 'authorizedBy', 'rationale', 'before', 'after'], 'scopeChange');
    for (const key of ['previousAssessmentId', 'authorizedBy', 'rationale']) text(scopeChange?.[key], `scopeChange.${key}`);
    for (const side of ['before', 'after']) {
      object(scopeChange?.[side], `scopeChange.${side}`);
      unknownKeys(scopeChange?.[side], ['scopeRevision', 'stage'], `scopeChange.${side}`);
      text(scopeChange?.[side]?.scopeRevision, `scopeChange.${side}.scopeRevision`);
      require(Object.hasOwn(apertureRules.stages, scopeChange?.[side]?.stage), 'STAGE', `scopeChange.${side}.stage`, 'Unknown stage.');
    }
    require(isObject(previousAssessment), 'HISTORY', 'scopeChange', 'Provide the retained previous assessment for scope-change verification.');
    require(scopeChange?.after?.scopeRevision === record.scope?.revision && scopeChange?.after?.stage === record.stage,
      'SCOPE', 'scopeChange.after', 'Scope-change target does not match the new assessment.');
    require(scopeChange?.before?.scopeRevision !== scopeChange?.after?.scopeRevision,
      'SCOPE', 'scopeChange', 'Every authorized scope change must advance the scope revision.');
  }
  if (isObject(previousAssessment)) {
    const oldArray = key => Array.isArray(previousAssessment[key]) ? previousAssessment[key] : [];
    for (const key of ['gates', 'dimensions', 'goals', 'findings']) require(Array.isArray(previousAssessment[key]), 'HISTORY', `previousAssessment.${key}`, 'Retained assessment is structurally incomplete.');
    require(previousAssessment.id !== record.id, 'HISTORY', 'id', 'A new assessment must have a new ID.');
    require(previousAssessment.plane === record.plane && previousAssessment.scope?.id === record.scope?.id,
      'HISTORY', 'scope', 'Previous assessment must refer to the same plane and scope identity.');
    const previousGates = new Map(oldArray('gates').filter(isObject).map(gate => [gate.id, gate]));
    const previousDimensions = new Map(oldArray('dimensions').filter(isObject).map(item => [item.id, item]));
    const scopeSignature = assessment => JSON.stringify({
      stage: assessment.stage, description: assessment.scope?.description,
      goals: (Array.isArray(assessment.goals) ? assessment.goals : []).filter(isObject).map(goal => [goal.id, goal.outcome, goal.mandatory]).sort(),
      dimensions: (Array.isArray(assessment.dimensions) ? assessment.dimensions : []).filter(isObject).map(item => [item.id, item.status === 'N/A',
        (Array.isArray(item.criteria) ? item.criteria : []).filter(isObject).map(criterion => [criterion.id, criterion.description,
          Array.isArray(criterion.goalIds) ? [...criterion.goalIds].sort() : []]).sort()]).sort(),
      gates: (Array.isArray(assessment.gates) ? assessment.gates : []).filter(isObject).map(gate => [gate.id, gate.mandatory, gate.applicable,
        Array.isArray(gate.goalIds) ? [...gate.goalIds].sort() : [], Array.isArray(gate.dimensionIds) ? [...gate.dimensionIds].sort() : [], gate.expected, gate.workload]).sort(),
    });
    const changed = previousAssessment.scope?.revision !== record.scope?.revision || scopeSignature(previousAssessment) !== scopeSignature(record);
    if (changed) {
      require(Boolean(scopeChange), 'SCOPE', 'scopeChange', 'Scope, stage, applicability or promise changed without authorization.');
      require(previousAssessment.scope?.revision !== record.scope?.revision, 'SCOPE', 'scope.revision', 'Changed scope requires a new scope revision.');
    }
    if (scopeChange) {
      require(scopeChange.previousAssessmentId === previousAssessment.id, 'HISTORY', 'scopeChange.previousAssessmentId', 'Previous assessment identity differs.');
      require(scopeChange.before?.scopeRevision === previousAssessment.scope?.revision && scopeChange.before?.stage === previousAssessment.stage,
        'SCOPE', 'scopeChange.before', 'Scope-change origin does not match the retained assessment.');
    }
    for (const old of oldArray('findings').filter(isObject)) {
      require(findings.has(old.id), 'HISTORY', 'findings', `Retain historical finding ${old.id}; close it with evidence or explicit scope change.`);
    }
    for (const [oldId, old] of previousGates) {
      if (old.mandatory && old.applicable && (!gates.has(oldId) || gates.get(oldId).mandatory !== true || gates.get(oldId).applicable !== true)) {
        require(Boolean(scopeChange), 'SCOPE', `gates.${oldId}`, 'A mandatory gate cannot silently disappear or be weakened.');
      }
    }
    for (const [oldId, old] of previousDimensions) if (old.status !== 'N/A' && dimensions.get(oldId)?.status === 'N/A') {
      require(Boolean(scopeChange), 'SCOPE', `dimensions.${oldId}`, 'New N/A applicability needs an authorized scope change.');
    }
  }
  if (errors.length !== historyErrorStart) for (const dimension of dimensionIds) invalidDimensions.add(dimension);
  const threshold = apertureRules.stages[record.stage] ?? null;
  const dimensionViews = apertureRules.dimensions.map(policy => {
    const entry = dimensions.get(policy.id);
    const ownedFindings = [...findings.values()].filter(finding => finding.dimension === policy.id);
    const activeFindings = ownedFindings.filter(finding => activeStatuses.has(finding.status));
    const mandatoryGates = gateViews.filter(gate => gate.mandatory && gate.applicable && gate.dimensionIds.includes(policy.id));
    let status = entry?.status ?? 'UNKNOWN';
    if (invalidDimensions.has(policy.id) || !['ASSESSED', 'UNKNOWN', 'N/A'].includes(status)) status = 'UNKNOWN';
    const calculated = status === 'ASSESSED' ? scoreDimension(ownedFindings) : { score: null, types: [], openFindingCount: activeFindings.length };
    const passesThreshold = status === 'N/A' || status === 'ASSESSED' && calculated.score >= threshold;
    if (!passesThreshold) blocked.push(`${policy.id}: ${status === 'ASSESSED' ? `${calculated.score}/10 below ${threshold}` : 'UNKNOWN'}.`);
    return { ...policy, status, ...calculated, threshold, passesThreshold,
      reason: invalidDimensions.has(policy.id) ? 'Invalid or stale assessment/evidence; re-review required.' : entry?.reason ?? '',
      findingIds: ownedFindings.map(finding => finding.id),
      mandatoryGates: mandatoryGates.map(gate => ({ id: gate.id, result: gate.result, passed: gate.passed })),
    };
  });
  const allApplicableUnknown = dimensionViews.filter(item => item.status !== 'N/A').every(item => item.status === 'UNKNOWN');
  const allRequiredNotRun = gateViews.filter(gate => gate.mandatory && gate.applicable).every(gate => gate.result === 'NOT RUN');
  const ready = errors.length === 0 && blocked.length === 0;
  return {
    assessmentId: record.id, plane: record.plane, stage: record.stage, binding, threshold,
    structuralStatus: errors.length ? 'FAIL' : 'PASS',
    readiness: ready ? 'PASS' : errors.length === 0 && allApplicableUnknown && allRequiredNotRun && record.authority?.allowed === true && !authorityBlockers.length ? 'NOT RUN' : 'BLOCKED',
    errors, blockers: [...new Set(blocked)], dimensions: dimensionViews,
    findings: structuredClone([...findings.values()]), gates: gateViews,
    limitations: 'Structural check only: declared local bytes, references and bindings were checked. This does not prove that tests ran, claims are true or all defects were found.',
  };
}

export async function readAssessment(file, options = {}) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > apertureLimits.assessmentBytes) throw new Error('Assessment must be a regular JSON file no larger than 4 MiB.');
  let record;
  try { record = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { throw new Error('Assessment is not valid JSON.'); }
  return evaluateAssessment(record, options);
}

function cell(value) { return String(value ?? '').replaceAll('|', '\\|').replace(/[\r\n]/g, ' '); }

export function renderScorecard(result) {
  const lines = [
    `# Aperture: ${cell(result.assessmentId ?? 'invalid assessment')}`,
    '', `${cell(result.plane ?? 'unknown plane')} | ${cell(result.stage ?? 'unknown stage')} | Readiness: **${result.readiness}** | Structural check: **${result.structuralStatus}**`,
    '', '| Dimension | Score | Active types | Open findings | Mandatory gates |',
    '| --- | ---: | --- | ---: | --- |',
  ];
  for (const dimension of result.dimensions) lines.push(`| ${dimension.id} ${cell(dimension.name)} | ${dimension.score === null ? dimension.status : `${dimension.score}/10`} | ${dimension.types.join(', ') || '—'} | ${dimension.openFindingCount} | ${dimension.mandatoryGates.map(gate => `${cell(gate.id)} ${gate.result}${gate.passed ? '' : ' [unpassed]'}`).join('; ') || 'None declared'} |`);
  lines.push('', '## Findings', '');
  if (!result.findings.length) lines.push('No findings declared. This is not proof that no defects exist.');
  for (const finding of result.findings) {
    const evidenceIds = Array.isArray(finding.evidenceIds) ? finding.evidenceIds : [];
    lines.push(`- **${cell(finding.id)}** · ${cell(finding.dimension)} · ${cell(finding.type)} · ${cell(finding.status)}: ${cell(finding.description)}`,
      `  Consequence: ${cell(finding.consequence)}. Correction: ${cell(finding.correction)}. Owner: ${cell(finding.owner)}. Evidence: ${evidenceIds.map(cell).join(', ') || cell(finding.unknown)}.`);
  }
  if (result.gates.length) {
    lines.push('', '## Gates', '');
    for (const gate of result.gates) lines.push(`- **${cell(gate.id)}**: ${gate.result}; ${gate.mandatory ? 'mandatory' : 'optional'}; ${gate.applicable ? 'applicable' : 'N/A'}; ${gate.evidenceValid ? 'structurally valid evidence' : 'invalid evidence'}${gate.reason ? `; ${cell(gate.reason)}` : ''}.`);
  }
  if (result.errors.length || result.blockers?.length) lines.push('', '## Blocking checks', '',
    ...result.errors.map(item => `- ${cell(item.code)} at ${cell(item.path)}: ${cell(item.message)}`),
    ...(result.blockers ?? []).map(item => `- ${cell(item)}`));
  lines.push('', result.limitations ?? 'Structural check only.', '');
  return lines.join('\n');
}
