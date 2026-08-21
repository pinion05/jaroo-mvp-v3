const FIELD_SPECS = Object.freeze([
  { canonicalField: 'paymentDate', valueKind: 'date', aliases: ['납입기일', '납입일'] },
  { canonicalField: 'issueDate', valueKind: 'date', aliases: ['발행일'] },
  { canonicalField: 'issuePrice', valueKind: 'money', aliases: ['발행가액'] },
  {
    canonicalField: 'issueAmount',
    valueKind: 'money',
    aliases: ['권면전자등록총액', '사채권면총액', '발행총액', '발행금액', '권면총액'],
  },
  { canonicalField: 'exchangePrice', valueKind: 'money', aliases: ['교환가액', '교환가격'] },
  { canonicalField: 'exchangeRatio', valueKind: 'rate', aliases: ['교환비율'] },
  { canonicalField: 'exchangeSubject', valueKind: 'text', aliases: ['교환대상'] },
  { canonicalField: 'exchangePeriod', valueKind: 'text', aliases: ['교환청구기간'] },
  { canonicalField: 'exchangeTerms', valueKind: 'text', aliases: ['교환조건'] },
  { canonicalField: 'maturityDate', valueKind: 'date', aliases: ['사채만기일', '만기일'] },
  { canonicalField: 'couponRate', valueKind: 'rate', aliases: ['표면이자율', '표면금리', '이자율'] },
  {
    canonicalField: 'maturityRate',
    valueKind: 'rate',
    aliases: ['만기보장수익률', '만기이자율', '보장수익률', '수익률'],
  },
  { canonicalField: 'redemptionDate', valueKind: 'date', aliases: ['상환기일', '상환일'] },
  { canonicalField: 'redemptionAmount', valueKind: 'money', aliases: ['상환금액'] },
  {
    canonicalField: 'redemptionTerms',
    valueKind: 'text',
    aliases: ['조기상환조건', '상환조건', '상환방법', '이자지급방법'],
  },
  {
    canonicalField: 'optionTerms',
    valueKind: 'text',
    aliases: ['매도청구권', '조기상환', '풋옵션', '콜옵션'],
  },
  { canonicalField: 'subscriptionDate', valueKind: 'date', aliases: ['청약일'] },
  { canonicalField: 'issueTarget', valueKind: 'text', aliases: ['발행대상자', '발행대상'] },
  { canonicalField: 'fundingPurpose', valueKind: 'text', aliases: ['자금조달목적'] },
  { canonicalField: 'boardResolutionDate', valueKind: 'date', aliases: ['이사회결의일'] },
  { canonicalField: 'issueTerms', valueKind: 'text', aliases: ['발행조건', '발행방법'] },
]);

const ALIAS_ENTRIES = Object.freeze(
  FIELD_SPECS.flatMap((spec) => spec.aliases.map((alias) => ({ alias, spec })))
    .sort((left, right) => right.alias.length - left.alias.length),
);

const CORRECTION_REASON = /(?:기재|내용|설명)?보완|정정사유|변경사유|일정기재|가격조정|금액조정|대상변경/u;
const AUXILIARY_CELL = /^(?:일자|일정|금액|가격|비율|조건|내용|내역|정정사유|변경사유|기재보완|내용보완|설명보완|대상변경)$/u;
const HEADER_CELL = /^(?:항목|정정항목|정정항목명|변경항목|구분|단위|정정사유|변경사유|정정근거|정정내용|정정전내용|정정후내용|비고)$/u;
const ROW_BOUNDARY = /^(?:별도(?:정정)?(?:행|항목)|다음(?:정정)?(?:행|항목)|정정사항끝|\d{1,3}[.)].+)$/u;
const EXAMPLE_CONTEXT = /(?:예시|민감도|시나리오|가정|최저|최고|비교예)/u;
const NARRATIVE_CELL = /(?:위험|설명|문구|주의|가능성|여부|검토|예정|참고|투자판단|기재보완|내용보완|설명보완)/u;
const NONOPERATIVE_LANGUAGE = /(?:가능성|여부|검토|예정|계획|논의|고려|가정|예시|시나리오)|(?:(?:변경|조정|수정|연기|확정|증액|감액|교체|삭제|추가|신설|해제|부여|연장|단축|취소|철회)(?:(?:하지(?:는)?않|하지아니|되지않|않음|아니함|없음)|(?:한|된)(?:바|사실)(?:이)?없))|설명(?:만|을|을만)?(?:추가|보완)/u;
const EXPLICIT_NO_CHANGE = /(?:변경(?:사항)?(?:은|이|을|를|에는)?없|(?:변경|조정|수정|연기|증액|감액|교체|삭제|추가|신설|해제|부여|연장|단축|취소|철회)(?:(?:하지(?:는)?않|하지아니|되지않|않음|아니함|사항없)|(?:한|된)(?:바|사실)(?:이)?없)|변동(?:이|은)?없|변함(?:이|은)?없|불변|(?:그대로|동일하게|현행대로|종전(?:수준)?(?:을|으로)?|기존(?:수준)?(?:을|으로)?)유지|유지(?:됩니다|한다|합니다|함|되었습니다|됐다|됨)?|(?:기존|종전)(?:과|와)?(?:동일|같))/u;
const OPERATIVE_VERB_SOURCE = '변경|조정|연기|확정|수정|증액|감액|교체|삭제|추가|신설|해제|부여|연장|단축|취소|철회';
const AFFIRMATIVE_OPERATIVE_VERB = /(?:변경|조정|연기|확정|수정|증액|감액|교체|삭제|추가|신설|해제|부여|연장|단축|취소|철회)/u;
const ALLOWED_GENERIC_ALIAS_PREFIX = /^(?:실제|당초|기존|종전)?$/u;

const MONEY_MULTIPLIERS = Object.freeze({
  조: 1_000_000_000_000n,
  억: 100_000_000n,
  천만: 10_000_000n,
  백만: 1_000_000n,
  십만: 100_000n,
  만: 10_000n,
  천: 1_000n,
  백: 100n,
  십: 10n,
});

const FIELD_UNIT_MULTIPLIERS = Object.freeze({
  억원: 100_000_000n,
  천만원: 10_000_000n,
  백만원: 1_000_000n,
  만원: 10_000n,
  천원: 1_000n,
  원: 1n,
  '원/주': 1n,
});

const KOREAN_DIGITS = Object.freeze({
  영: 0n,
  공: 0n,
  일: 1n,
  이: 2n,
  삼: 3n,
  사: 4n,
  오: 5n,
  육: 6n,
  칠: 7n,
  팔: 8n,
  구: 9n,
});
const KOREAN_SMALL_UNITS = Object.freeze({ 십: 10n, 백: 100n, 천: 1_000n });
const KOREAN_LARGE_UNITS = Object.freeze({ 만: 10_000n, 억: 100_000_000n, 조: 1_000_000_000_000n });

function compactText(value) {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).normalize('NFKC').replaceAll(/\s+/gu, '');
}

function normalizeFieldText(value) {
  return compactText(value).replaceAll('(전자등록)', '전자등록');
}

function canonicalizeNoteTokens(value) {
  return compactText(value)
    .replace(/\[주(\d+)\]/gu, '(주$1)')
    .replace(/(^|[^([])주(\d+)\)/gu, '$1(주$2)');
}

function parseFieldLabel(value) {
  let field = normalizeFieldText(value)
    .replace(/^\(주\d+\)/u, '')
    .replace(/\(주\d+\)$/u, '')
    .replace(/^(?:(?:제)?\d{1,3}항|(?:제)?\d{1,3}[.)])/u, '')
    .replace(/^[.:：-]+|[.:：-]+$/gu, '')
    .replace(/^사채의/u, '');

  let unitMultiplier = 1n;
  const unitMatch = field.match(/\((억원|천만원|백만원|만원|천원|원\/주|원|연?%|일자|기준)\)$/u);
  if (unitMatch) {
    unitMultiplier = FIELD_UNIT_MULTIPLIERS[unitMatch[1]] ?? 1n;
    field = field.slice(0, -unitMatch[0].length);
  }

  const spec = FIELD_SPECS.find((candidate) => candidate.aliases.includes(field));
  return spec ? Object.freeze({ spec, unitMultiplier }) : null;
}

function findMentionedFields(value) {
  const text = normalizeFieldText(value);
  const mentions = [];
  for (const entry of ALIAS_ENTRIES) {
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const index = text.indexOf(entry.alias, searchFrom);
      if (index < 0) break;
      searchFrom = index + entry.alias.length;
      if ((entry.alias === '수익률' || entry.alias === '이자율')
        && !ALLOWED_GENERIC_ALIAS_PREFIX.test(text.slice(0, index))) continue;
      if (mentions.some((mention) => (
        index < mention.index + mention.alias.length
        && mention.index < index + entry.alias.length
      ))) continue;
      mentions.push(Object.freeze({ ...entry, index, text }));
    }
  }
  return mentions.sort((left, right) => left.index - right.index);
}

function findMentionedField(value) {
  return findMentionedFields(value)[0] ?? null;
}

function stripMentionedAlias(value, mention) {
  const prefix = mention.text.slice(0, mention.index);
  if (prefix && !/^(?:실제|당초|기존|종전)$/u.test(prefix)) return null;
  return mention.text
    .slice(mention.index + mention.alias.length)
    .replace(/^(?:은|는|이|가|을|를|의|[:：-])+/u, '');
}

function normalizeDecimal(value) {
  const match = String(value).match(/^([+-]?)(\d+)(?:\.(\d+))?$/u);
  if (!match) return null;
  const sign = match[1] === '-' ? '-' : '';
  const integer = match[2].replace(/^0+(?=\d)/u, '') || '0';
  const fraction = (match[3] ?? '').replace(/0+$/u, '');
  const normalized = fraction ? `${integer}.${fraction}` : integer;
  return normalized === '0' ? '0' : `${sign}${normalized}`;
}

function decimalToScaledInteger(value, multiplier) {
  const normalized = normalizeDecimal(value);
  if (normalized === null) return null;
  const negative = normalized.startsWith('-');
  const absolute = negative ? normalized.slice(1) : normalized;
  const [integer, fraction = ''] = absolute.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${integer}${fraction}` || '0') * multiplier;
  if (numerator % denominator !== 0n) return null;
  const scaled = numerator / denominator;
  return negative ? -scaled : scaled;
}

function divideDecimal(value, divisor) {
  const normalized = normalizeDecimal(value);
  if (normalized === null) return null;
  const negative = normalized.startsWith('-');
  const absolute = negative ? normalized.slice(1) : normalized;
  const [integer, fraction = ''] = absolute.split('.');
  const numerator = BigInt(`${integer}${fraction}` || '0');
  const decimalPlaces = fraction.length + String(divisor).length - 1;
  const padded = numerator.toString().padStart(decimalPlaces + 1, '0');
  const whole = padded.slice(0, -decimalPlaces) || '0';
  const decimals = padded.slice(-decimalPlaces).replace(/0+$/u, '');
  return normalizeDecimal(`${negative ? '-' : ''}${whole}${decimals ? `.${decimals}` : ''}`);
}

function normalizeKoreanInteger(value) {
  if (!/^[영공일이삼사오육칠팔구십백천만억조]+$/u.test(value)) return null;
  let total = 0n;
  let section = 0n;
  let digit = null;
  for (const token of value) {
    if (Object.hasOwn(KOREAN_DIGITS, token)) {
      digit = KOREAN_DIGITS[token];
      continue;
    }
    if (Object.hasOwn(KOREAN_SMALL_UNITS, token)) {
      section += (digit ?? 1n) * KOREAN_SMALL_UNITS[token];
      digit = null;
      continue;
    }
    section += digit ?? 0n;
    total += (section || 1n) * KOREAN_LARGE_UNITS[token];
    section = 0n;
    digit = null;
  }
  return (total + section + (digit ?? 0n)).toString();
}

function stripValueAnnotations(value) {
  return compactText(value)
    .replace(/(?:\((?:예정|잠정|확정|영업일|월|화|수|목|금|토|일)\))+$/u, '')
    .replace(/[.]$/u, '');
}

function normalizeDate(value) {
  const text = stripValueAnnotations(value);
  const compactMatch = text.match(/^(20\d{2})(\d{2})(\d{2})$/u);
  const match = compactMatch ?? text.match(/^(20\d{2})[년./-](\d{1,2})[월./-](\d{1,2})일?$/u);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeMoney(value, fieldMultiplier = 1n) {
  let annotated = compactText(value);
  if (/^\(.+\)$/u.test(annotated)) annotated = annotated.slice(1, -1);
  annotated = annotated.replace(/(?<=원)\([^()]+\)$/u, '');
  const hasExplicitUnit = /(?:KRW|₩|원|조|억|천만|백만|십만|만|천|백|십)/iu.test(annotated);
  let text = stripValueAnnotations(annotated)
    .replaceAll(',', '')
    .replace(/^금/u, '')
    .replace(/^(?:KRW|₩)/iu, '')
    .replace(/(?:KRW)$/iu, '')
    .replace(/원$/u, '');
  if (!text) return null;

  const plain = normalizeDecimal(text);
  if (plain !== null) {
    const scaled = decimalToScaledInteger(plain, hasExplicitUnit ? 1n : fieldMultiplier);
    return scaled === null ? null : scaled.toString();
  }

  const koreanInteger = normalizeKoreanInteger(text);
  if (koreanInteger !== null) return koreanInteger;

  const tokenPattern = /([+-]?\d+(?:\.\d+)?)(천만|백만|십만|조|억|만|천|백|십)/gu;
  let cursor = 0;
  let total = 0n;
  let matched = false;
  for (const match of text.matchAll(tokenPattern)) {
    if (match.index !== cursor) return null;
    const scaled = decimalToScaledInteger(match[1], MONEY_MULTIPLIERS[match[2]]);
    if (scaled === null) return null;
    total += scaled;
    cursor = match.index + match[0].length;
    matched = true;
  }
  return matched && cursor === text.length ? total.toString() : null;
}

function normalizeRate(value) {
  let text = stripValueAnnotations(value)
    .replace(/\(연\)$/u, '')
    .replace(/^(?:연이율|연율|연)/u, '');
  const basisPoints = text.match(/^([+-]?\d+(?:\.\d+)?)bp$/iu);
  if (basisPoints) return divideDecimal(basisPoints[1], 100);
  text = text.replace(/(?:%p|%포인트|퍼센트포인트|%|퍼센트)$/iu, '');
  return normalizeDecimal(text);
}

function normalizeValue(fieldInfo, rawValue) {
  const raw = String(rawValue ?? '');
  const text = compactText(raw);
  if (/^(?:-|—|미정|미확정|해당없음|없음)$/u.test(text)) {
    return Object.freeze({ raw, normalized: 'unset', kind: 'unset', direct: true });
  }

  const { spec, unitMultiplier = 1n } = fieldInfo;
  const normalized = spec.valueKind === 'date'
    ? normalizeDate(text)
    : spec.valueKind === 'money'
      ? normalizeMoney(text, unitMultiplier)
      : spec.valueKind === 'rate'
        ? normalizeRate(text)
        : text || null;
  const direct = normalized !== null
    && (spec.valueKind !== 'text' || !/(?:위험|설명|문구|주의|가능성|여부|검토|참고|투자판단|기재보완|내용보완|설명보완)/u.test(text));
  return Object.freeze({
    raw,
    normalized: normalized ?? text,
    kind: normalized === null ? 'text' : spec.valueKind,
    direct,
  });
}

function parseMarker(value) {
  let text = canonicalizeNoteTokens(value);
  const prefixNote = text.match(/^\(주(\d+)\)/u);
  if (prefixNote) text = text.slice(prefixNote[0].length);
  const match = text.match(/^\(?(정정전|변경전|변경이전|정정후|변경후|변경이후)\)?/u);
  if (!match) return null;
  text = text.slice(match[0].length);
  const suffixNote = text.match(/^\(주(\d+)\)/u);
  if (suffixNote) text = text.slice(suffixNote[0].length);
  return Object.freeze({
    side: /전$|이전$/u.test(match[1]) ? 'before' : 'after',
    note: prefixNote?.[1] ?? suffixNote?.[1] ?? null,
    inlineValue: text.replace(/^[:：-]+/u, ''),
  });
}

function notesMatch(left, right) {
  return left === right;
}

function isFieldHeader(value) {
  return /^(?:항목|정정항목|정정항목명|변경항목|구분)$/u.test(compactText(value));
}

function isHeaderStart(value) {
  return isFieldHeader(value) || compactText(value) === '번호';
}

function isHeaderCell(value) {
  const marker = parseMarker(value);
  return HEADER_CELL.test(compactText(value)) || Boolean(marker && !marker.inlineValue);
}

function headerMarkerSide(value) {
  const text = compactText(value);
  if (/^(?:정정전|변경전|변경이전)(?:내용)?$/u.test(text)) return 'before';
  if (/^(?:정정후|변경후|변경이후)(?:내용)?$/u.test(text)) return 'after';
  const marker = parseMarker(value);
  return marker && !marker.inlineValue ? marker.side : null;
}

function moneyUnitMultiplier(value) {
  const unit = compactText(value).replace(/^\(|\)$/gu, '');
  return FIELD_UNIT_MULTIPLIERS[unit] ?? null;
}

function isAuxiliary(value) {
  const text = compactText(value);
  return AUXILIARY_CELL.test(text) || CORRECTION_REASON.test(text);
}

function collectNoChangeEvidence(clauses) {
  const evidence = [];
  for (let index = 0; index < clauses.length; index += 1) {
    if (!EXPLICIT_NO_CHANGE.test(clauses[index])) continue;
    const mention = findMentionedField(clauses[index]);
    if (mention) evidence.push(Object.freeze({ canonicalField: mention.spec.canonicalField, index }));
  }
  return evidence;
}

function buildCandidate({
  fieldInfo,
  beforeRaw = null,
  afterRaw = null,
  evidenceKind,
  sourceRange,
  evidenceRange = sourceRange,
  clauses,
  noChangeEvidence,
  forceOperative = false,
}) {
  const { spec } = fieldInfo;
  const beforeValue = beforeRaw === null ? null : normalizeValue(fieldInfo, beforeRaw);
  const afterValue = afterRaw === null ? null : normalizeValue(fieldInfo, afterRaw);
  const explicitNoChange = noChangeEvidence.some((evidence) => (
    evidence.canonicalField === spec.canonicalField
    && evidence.index >= evidenceRange[0]
    && evidence.index <= evidenceRange[1]
  ));
  let classification = 'unknown';
  let conflict = 'none';

  if (forceOperative) {
    classification = 'operative';
    if (explicitNoChange) conflict = 'direct-delta-vs-no-change';
  } else if (beforeValue?.direct && afterValue?.direct) {
    if (beforeValue.normalized === afterValue.normalized) {
      classification = 'nonoperative';
    } else {
      classification = 'operative';
      if (explicitNoChange) conflict = 'direct-delta-vs-no-change';
    }
  } else if (explicitNoChange || (beforeValue && afterValue)) {
    classification = 'nonoperative';
  }

  return Object.freeze({
    canonicalField: spec.canonicalField,
    beforeValue,
    afterValue,
    valueKind: spec.valueKind,
    evidenceKind,
    explicitNoChange,
    classification,
    conflict,
    sourceRange: Object.freeze(sourceRange),
  });
}

function addRange(indexes, start, end) {
  for (let index = start; index <= end; index += 1) indexes.add(index);
}

function headerMarkersAhead(clauses, start, end) {
  const sides = new Set();
  for (let index = start; index <= end; index += 1) {
    const side = headerMarkerSide(clauses[index]);
    if (side) sides.add(side);
  }
  return sides.has('before') && sides.has('after');
}

function parseHeaderFirstCandidates(clauses, noChangeEvidence) {
  const candidates = [];
  const claimedIndexes = new Set();
  for (let headerStart = 0; headerStart < clauses.length; headerStart += 1) {
    if (claimedIndexes.has(headerStart) || !isHeaderStart(clauses[headerStart])) continue;
    let headerEnd = headerStart;
    let sawBefore = false;
    let sawAfter = false;
    while (headerEnd + 1 < clauses.length && headerEnd - headerStart < 11) {
      const next = clauses[headerEnd + 1];
      if (parseFieldLabel(next)) break;
      const side = headerMarkerSide(next);
      if (side === 'before') sawBefore = true;
      if (side === 'after') sawAfter = true;
      const markerPairAhead = headerMarkersAhead(
        clauses,
        headerEnd + 1,
        Math.min(clauses.length - 1, headerEnd + 6),
      );
      if (!isHeaderCell(next) && !(sawBefore && sawAfter) && !markerPairAhead) break;
      if (sawBefore && sawAfter
        && compactText(clauses[headerStart]) === '번호'
        && /^\d{1,4}[.)]?$/u.test(compactText(next))) break;
      headerEnd += 1;
    }
    const width = headerEnd - headerStart + 1;
    if (width < 3) continue;

    let beforeColumn = -1;
    let afterColumn = -1;
    let unitColumn = -1;
    let fieldColumn = -1;
    for (let column = 0; column < width; column += 1) {
      const headerCell = clauses[headerStart + column];
      const side = headerMarkerSide(headerCell);
      if (side === 'before') beforeColumn = column;
      if (side === 'after') afterColumn = column;
      if (compactText(headerCell) === '단위') unitColumn = column;
      if (fieldColumn < 0 && isFieldHeader(headerCell)) fieldColumn = column;
    }
    if (fieldColumn < 0 || beforeColumn < 0 || afterColumn < 0 || beforeColumn >= afterColumn) continue;

    addRange(claimedIndexes, headerStart, headerEnd);
    let rowStart = headerEnd + 1;
    while (rowStart + width <= clauses.length) {
      const parsedFieldInfo = parseFieldLabel(clauses[rowStart + fieldColumn]);
      if (!parsedFieldInfo) break;
      const fieldInfo = parsedFieldInfo.spec.valueKind === 'money' && unitColumn >= 0
        ? {
          ...parsedFieldInfo,
          unitMultiplier: moneyUnitMultiplier(clauses[rowStart + unitColumn])
            ?? parsedFieldInfo.unitMultiplier,
        }
        : parsedFieldInfo;
      const rowEnd = rowStart + width - 1;
      candidates.push(buildCandidate({
        fieldInfo,
        beforeRaw: clauses[rowStart + beforeColumn],
        afterRaw: clauses[rowStart + afterColumn],
        evidenceKind: 'header-first',
        sourceRange: [rowStart, rowEnd],
        clauses,
        noChangeEvidence,
      }));
      addRange(claimedIndexes, rowStart, rowEnd);
      rowStart += width;
    }
  }
  return { candidates, claimedIndexes };
}

function findFieldBefore(clauses, markerIndex) {
  for (let distance = 1; distance <= 8; distance += 1) {
    const index = markerIndex - distance;
    if (index < 0) break;
    const fieldInfo = parseFieldLabel(clauses[index]);
    if (ROW_BOUNDARY.test(clauses[index]) && !fieldInfo) break;
    if (!fieldInfo) continue;
    if (clauses.slice(index + 1, markerIndex).every(isAuxiliary)) return { fieldInfo, index };
    break;
  }
  return null;
}

function findFieldAfter(clauses, valueIndex) {
  for (let distance = 1; distance <= 8; distance += 1) {
    const index = valueIndex + distance;
    if (index >= clauses.length) break;
    const fieldInfo = parseFieldLabel(clauses[index]);
    if (ROW_BOUNDARY.test(clauses[index]) && !fieldInfo) break;
    if (!fieldInfo) continue;
    if (clauses.slice(valueIndex + 1, index).every(isAuxiliary)) return { fieldInfo, index };
    break;
  }
  return null;
}

function extendRowEnd(clauses, valueEndIndex) {
  let end = valueEndIndex;
  for (let index = valueEndIndex + 1; index < clauses.length; index += 1) {
    const clause = clauses[index];
    if (ROW_BOUNDARY.test(clause) || isFieldHeader(clause) || parseFieldLabel(clause)) break;
    if (parseMarker(clause)?.side === 'before') break;
    end = index;
  }
  return end;
}

function prefixedValuePair(beforeRaw, afterRaw) {
  const beforeMention = findMentionedField(beforeRaw);
  const afterMention = findMentionedField(afterRaw);
  if (!beforeMention || beforeMention.spec.canonicalField !== afterMention?.spec.canonicalField) return null;
  const beforeValue = stripMentionedAlias(beforeRaw, beforeMention);
  const afterValue = stripMentionedAlias(afterRaw, afterMention);
  if (beforeValue === null || afterValue === null) return null;
  const fieldInfo = { spec: beforeMention.spec, unitMultiplier: 1n };
  const before = normalizeValue(fieldInfo, beforeValue);
  const after = normalizeValue(fieldInfo, afterValue);
  if (!before.direct || !after.direct) return null;
  return { fieldInfo, beforeRaw: beforeValue, afterRaw: afterValue };
}

function hasInterveningField(clauses, start, end) {
  for (let index = start; index <= end; index += 1) {
    if (parseFieldLabel(clauses[index])) return true;
  }
  return false;
}

function parseRowFirstCandidates(clauses, noChangeEvidence, claimedIndexes) {
  const candidates = [];
  for (let beforeMarkerIndex = 0; beforeMarkerIndex < clauses.length; beforeMarkerIndex += 1) {
    if (claimedIndexes.has(beforeMarkerIndex)) continue;
    const beforeMarker = parseMarker(clauses[beforeMarkerIndex]);
    if (beforeMarker?.side !== 'before') continue;

    let afterMarkerIndex = -1;
    let afterMarker = null;
    for (let index = beforeMarkerIndex + 1; index < Math.min(clauses.length, beforeMarkerIndex + 11); index += 1) {
      if (ROW_BOUNDARY.test(clauses[index])) break;
      const marker = parseMarker(clauses[index]);
      if (!marker) continue;
      if (marker.side === 'before' && notesMatch(beforeMarker.note, marker.note)) break;
      if (marker.side !== 'after' || !notesMatch(beforeMarker.note, marker.note)) continue;
      afterMarkerIndex = index;
      afterMarker = marker;
      break;
    }
    if (afterMarkerIndex < 0) continue;

    const beforeValueIndex = beforeMarker.inlineValue ? beforeMarkerIndex : beforeMarkerIndex + 1;
    const afterValueIndex = afterMarker.inlineValue ? afterMarkerIndex : afterMarkerIndex + 1;
    const beforeRaw = beforeMarker.inlineValue || clauses[beforeValueIndex];
    const afterRaw = afterMarker.inlineValue || clauses[afterValueIndex];
    if (!beforeRaw || !afterRaw || parseMarker(beforeRaw) || parseMarker(afterRaw)) continue;

    const nearbyField = findFieldBefore(clauses, beforeMarkerIndex)
      ?? findFieldAfter(clauses, afterValueIndex);
    const prefixed = nearbyField ? null : prefixedValuePair(beforeRaw, afterRaw);
    const fieldInfo = nearbyField?.fieldInfo ?? prefixed?.fieldInfo;
    if (!fieldInfo) continue;
    if (hasInterveningField(
      clauses,
      beforeMarkerIndex + 1,
      afterMarkerIndex,
    )) continue;

    const sourceStart = nearbyField?.index ?? beforeMarkerIndex;
    const sourceEnd = Math.max(afterValueIndex, nearbyField?.index ?? 0);
    candidates.push(buildCandidate({
      fieldInfo,
      beforeRaw: prefixed?.beforeRaw ?? beforeRaw,
      afterRaw: prefixed?.afterRaw ?? afterRaw,
      evidenceKind: beforeMarker.note || afterMarker.note || /[()]/u.test(clauses[beforeMarkerIndex])
        ? 'parenthetical-marker'
        : 'row-first',
      sourceRange: [sourceStart, sourceEnd],
      evidenceRange: [sourceStart, extendRowEnd(clauses, sourceEnd)],
      clauses,
      noChangeEvidence,
    }));
  }
  return candidates;
}

const EMBEDDED_MARKER = /(\(주(\d+)\))?\(?(정정전|변경전|변경이전|정정후|변경후|변경이후)\)?(\(주(\d+)\))?/gu;

function findEmbeddedMarkers(clause) {
  const markers = [];
  for (const match of clause.matchAll(EMBEDDED_MARKER)) {
    markers.push({
      side: /전$|이전$/u.test(match[3]) ? 'before' : 'after',
      note: match[2] ?? match[5] ?? null,
      index: match.index,
      end: match.index + match[0].length,
    });
  }
  return markers;
}

function parseEmbeddedCandidates(clauses, noChangeEvidence, claimedIndexes) {
  const candidates = [];
  for (let index = 0; index < clauses.length; index += 1) {
    if (claimedIndexes.has(index)) continue;
    const clause = canonicalizeNoteTokens(clauses[index]);
    const mentions = findMentionedFields(clause);
    if (mentions.length === 0) continue;
    const markers = findEmbeddedMarkers(clause);
    for (const beforeMarker of markers.filter(({ side }) => side === 'before')) {
      const mention = [...mentions].reverse().find((candidate) => candidate.index < beforeMarker.index);
      if (!mention) continue;
      const nextBefore = markers.find((marker) => marker.side === 'before' && marker.index > beforeMarker.index);
      const afterMarker = markers.find((marker) => (
        marker.side === 'after'
        && marker.index > beforeMarker.index
        && (!nextBefore || marker.index < nextBefore.index)
        && notesMatch(beforeMarker.note, marker.note)
      ));
      if (!afterMarker) continue;
      const nextMention = mentions.find((candidate) => candidate.index > afterMarker.end);
      const afterEnd = nextMention && (!nextBefore || nextMention.index < nextBefore.index)
        ? nextMention.index
        : nextBefore?.index ?? clause.length;
      const beforeRaw = clause.slice(beforeMarker.end, afterMarker.index)
        .replace(/^[:：,;，；-]+|(?:[:：,;，；-]|및|그리고)+$/gu, '');
      const afterRaw = clause.slice(afterMarker.end, afterEnd)
        .replace(/^[:：,;，；-]+|(?:[:：,;，；-]|및|그리고)+$/gu, '');
      if (!beforeRaw || !afterRaw) continue;
      candidates.push(buildCandidate({
        fieldInfo: { spec: mention.spec, unitMultiplier: 1n },
        beforeRaw,
        afterRaw,
        evidenceKind: 'embedded-marker',
        sourceRange: [index, index],
        clauses,
        noChangeEvidence,
      }));
    }
  }
  return candidates;
}

function parseUnmarkedCandidates(clauses, noChangeEvidence, claimedIndexes) {
  const candidates = [];
  for (let fieldIndex = 0; fieldIndex < clauses.length; fieldIndex += 1) {
    if (claimedIndexes.has(fieldIndex)) continue;
    const fieldInfo = parseFieldLabel(clauses[fieldIndex]);
    if (!fieldInfo || fieldInfo.spec.valueKind === 'text') continue;
    const values = [];
    let hasLocalCorrectionReason = false;
    for (let index = fieldIndex + 1; index < Math.min(clauses.length, fieldIndex + 6); index += 1) {
      if (ROW_BOUNDARY.test(clauses[index]) || parseMarker(clauses[index])
        || parseFieldLabel(clauses[index]) || isFieldHeader(clauses[index])) break;
      if (CORRECTION_REASON.test(clauses[index])
        && !NONOPERATIVE_LANGUAGE.test(clauses[index])) hasLocalCorrectionReason = true;
      const value = normalizeValue(fieldInfo, clauses[index]);
      if (value.direct) values.push({ raw: clauses[index], index });
      else if (!isAuxiliary(clauses[index])) break;
      if (values.length === 2) break;
    }
    if (!hasLocalCorrectionReason || values.length !== 2) continue;
    const context = clauses.slice(fieldIndex, Math.min(clauses.length, values[1].index + 3)).join('');
    if (EXAMPLE_CONTEXT.test(context)) continue;
    candidates.push(buildCandidate({
      fieldInfo,
      beforeRaw: values[0].raw,
      afterRaw: values[1].raw,
      evidenceKind: 'unmarked-row',
      sourceRange: [fieldIndex, values[1].index],
      clauses,
      noChangeEvidence,
    }));
  }
  return candidates;
}

function parseInlineFromToCandidates(clauses, noChangeEvidence, claimedIndexes) {
  const candidates = [];
  const pattern = new RegExp(`^(?:은|는|이|가|을|를)?(.+?)에서(.+?)(?:으)?로(${OPERATIVE_VERB_SOURCE})(.*)$`, 'u');
  for (let index = 0; index < clauses.length; index += 1) {
    if (claimedIndexes.has(index)) continue;
    const clause = clauses[index];
    if (EXPLICIT_NO_CHANGE.test(clause)) continue;
    const mention = findMentionedField(clause);
    if (!mention) continue;
    const tail = mention.text.slice(mention.index + mention.alias.length);
    const match = tail.match(pattern);
    if (!match) continue;
    if (NONOPERATIVE_LANGUAGE.test(`${match[3]}${match[4]}`)) continue;
    const fieldInfo = { spec: mention.spec, unitMultiplier: 1n };
    const beforeValue = normalizeValue(fieldInfo, match[1]);
    const afterValue = normalizeValue(fieldInfo, match[2]);
    if (!beforeValue.direct || !afterValue.direct) continue;
    candidates.push(buildCandidate({
      fieldInfo,
      beforeRaw: match[1],
      afterRaw: match[2],
      evidenceKind: 'inline',
      sourceRange: [index, index],
      clauses,
      noChangeEvidence,
    }));
  }
  return candidates;
}

function parseLexicalCandidates(clauses, noChangeEvidence, claimedIndexes) {
  const candidates = [];
  for (let index = 0; index < clauses.length; index += 1) {
    if (claimedIndexes.has(index)) continue;
    const clause = clauses[index];
    const mention = findMentionedField(clause);
    if (!mention || EXPLICIT_NO_CHANGE.test(clause) || NONOPERATIVE_LANGUAGE.test(clause)) continue;
    if (NARRATIVE_CELL.test(clause) || !AFFIRMATIVE_OPERATIVE_VERB.test(clause)) continue;
    candidates.push(buildCandidate({
      fieldInfo: { spec: mention.spec, unitMultiplier: 1n },
      evidenceKind: 'lexical',
      sourceRange: [index, index],
      clauses,
      noChangeEvidence,
      forceOperative: true,
    }));
  }
  return candidates;
}

function rangesOverlap(left, right) {
  return left[0] <= right[1] && right[0] <= left[1];
}

function dedupeCandidates(candidates) {
  const deduped = [];
  for (const candidate of candidates) {
    const duplicate = deduped.some((existing) => (
      existing.canonicalField === candidate.canonicalField
      && rangesOverlap(existing.sourceRange, candidate.sourceRange)
      && !(existing.evidenceKind === 'embedded-marker' && candidate.evidenceKind === 'embedded-marker')
      && existing.beforeValue?.normalized === candidate.beforeValue?.normalized
      && existing.afterValue?.normalized === candidate.afterValue?.normalized
      && existing.classification === candidate.classification
    ));
    if (!duplicate) deduped.push(candidate);
  }
  return deduped;
}

export function analyzeExchangeableBondCorrection(scopeText = '') {
  const scope = compactText(scopeText);
  const clauses = scope.split('|');
  while (clauses[0] === '') clauses.shift();
  while (clauses.at(-1) === '') clauses.pop();
  const noChangeEvidence = collectNoChangeEvidence(clauses);
  const header = parseHeaderFirstCandidates(clauses, noChangeEvidence);
  const candidates = Object.freeze(dedupeCandidates([
    ...header.candidates,
    ...parseRowFirstCandidates(clauses, noChangeEvidence, header.claimedIndexes),
    ...parseEmbeddedCandidates(clauses, noChangeEvidence, header.claimedIndexes),
    ...parseUnmarkedCandidates(clauses, noChangeEvidence, header.claimedIndexes),
    ...parseInlineFromToCandidates(clauses, noChangeEvidence, header.claimedIndexes),
    ...parseLexicalCandidates(clauses, noChangeEvidence, header.claimedIndexes),
  ]));
  return Object.freeze({
    scope,
    candidates,
    hasOperativeDelta: candidates.some(({ classification }) => classification === 'operative'),
    hasConflict: candidates.some(({ conflict }) => conflict !== 'none'),
  });
}
