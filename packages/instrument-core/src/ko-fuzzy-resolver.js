const fs = require('node:fs');
const path = require('node:path');
const { correctByDistance, getDistance } = require('hangul-util');

const DEFAULT_KO_MAP_PATH = path.resolve(__dirname, '../data/us/us-stock-name-ko-to-ticker-coverage100.json');
const DEFAULT_TICKER_INFO_PATH = path.resolve(__dirname, '../data/us/us-stock-ticker-to-ko-en-coverage100.json');

const STRIP_TOKENS = [
  '홀딩스',
  '홀딩',
  '그룹',
  '테크놀로지스',
  '테크놀로지',
  '컴퍼니',
  '코퍼레이션',
  '인더스트리즈',
  '인더스트리얼',
  '프로퍼티스',
  '파마슈티컬스',
  '리얼티',
  '트러스트',
  '워런트',
  '유닛',
  'ADR',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[·•ㆍ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function exposeBracketedTokens(text) {
  return normalizeText(text)
    .replace(/\(([^)]*)\)/g, ' $1 ')
    .replace(/\[([^\]]*)\]/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(text) {
  return normalizeText(text).replace(/[^0-9A-Za-z가-힣]+/g, '').toUpperCase();
}

function stripDecorators(text) {
  let value = normalizeText(text)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/클래스\s*[A-Z]/gi, ' ')
    .replace(/우선주\s*[A-Z0-9-]*/gi, ' ')
    .replace(/시리즈\s*[A-Z0-9]+/gi, ' ')
    .replace(/CLASS\s*[A-Z]/gi, ' ');

  for (const token of STRIP_TOKENS) {
    value = value.replaceAll(token, ' ');
  }

  return value.replace(/\s+/g, ' ').trim();
}

function addMapEntry(map, key, ticker) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(ticker);
}

function pushIndex(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function dedupeByTicker(candidates, topN) {
  const deduped = [];
  const seen = new Set();
  for (const item of candidates) {
    if (seen.has(item.ticker)) continue;
    seen.add(item.ticker);
    deduped.push(item);
    if (deduped.length >= topN) break;
  }
  return deduped;
}

function isLikelyPrimaryTicker(ticker) {
  return !/[-]/.test(ticker);
}

function charBigrams(text) {
  const value = String(text || '');
  if (!value) return [];
  if (value.length === 1) return [value];
  const grams = [];
  for (let i = 0; i < value.length - 1; i += 1) {
    grams.push(value.slice(i, i + 2));
  }
  return [...new Set(grams)];
}

function bigramOverlapScore(a, b) {
  const left = new Set(charBigrams(a));
  const right = new Set(charBigrams(b));
  if (!left.size || !right.size) return 0;

  let overlap = 0;
  for (const gram of left) {
    if (right.has(gram)) overlap += 1;
  }

  return overlap / Math.max(left.size, right.size, 1);
}

function baselineCandidateScore(query, alias) {
  const qNorm = stripDecorators(query);
  const aNorm = stripDecorators(alias);
  const qCompact = compactText(qNorm);
  const aCompact = compactText(aNorm);

  if (!qCompact || !aCompact) return 0;

  const compactSim = 1 - getDistance(qCompact, aCompact) / Math.max(qCompact.length, aCompact.length, 1);
  const normSim = 1 - getDistance(qNorm, aNorm) / Math.max(qNorm.length, aNorm.length, 1);
  let score = Math.max(compactSim, normSim);

  if (qCompact === aCompact) score = 1;
  else if (aCompact.includes(qCompact) || qCompact.includes(aCompact)) score = Math.max(score, 0.92);

  return Number(score.toFixed(4));
}

function candidateScore(query, alias) {
  const qNorm = stripDecorators(query);
  const aNorm = stripDecorators(alias);
  const qCompact = compactText(qNorm);
  const aCompact = compactText(aNorm);

  if (!qCompact || !aCompact) return 0;

  const overlap = bigramOverlapScore(qCompact, aCompact);
  let score = baselineCandidateScore(query, alias);

  if (overlap >= 0.5) score = Math.max(score, Number(((score * 0.88) + (overlap * 0.12)).toFixed(4)));
  if (qCompact.length <= 3 && aCompact[0] === qCompact[0]) score += 0.015;
  if (qCompact.length <= 3 && aCompact.startsWith(qCompact.slice(0, 1))) score += 0.01;

  return Number(Math.max(0, Math.min(1, score)).toFixed(4));
}

function buildIndex(koNameToTicker) {
  const displayAliasToTickers = new Map();
  const compactAliasToTickers = new Map();
  const tickerToNames = new Map();
  const aliasEntries = [];
  const compactToEntries = new Map();
  const compactBigramIndex = new Map();
  const compactPrefixIndex = new Map();
  const compactLengthIndex = new Map();
  const seenAliasEntry = new Set();

  for (const [name, ticker] of Object.entries(koNameToTicker)) {
    if (!tickerToNames.has(ticker)) tickerToNames.set(ticker, []);
    tickerToNames.get(ticker).push(name);

    const stripped = stripDecorators(name);
    const variants = new Set([normalizeText(name), stripped]);

    for (const alias of variants) {
      if (!alias) continue;
      addMapEntry(displayAliasToTickers, alias, ticker);
      addMapEntry(compactAliasToTickers, compactText(alias), ticker);

      const key = `${ticker}::${alias}`;
      if (seenAliasEntry.has(key)) continue;
      seenAliasEntry.add(key);

      const entry = {
        ticker,
        alias,
        compact: compactText(alias),
      };

      aliasEntries.push(entry);
      pushIndex(compactToEntries, entry.compact, entry);
      pushIndex(compactPrefixIndex, entry.compact[0], entry);
      pushIndex(compactLengthIndex, String(entry.compact.length), entry);
      for (const gram of charBigrams(entry.compact)) {
        pushIndex(compactBigramIndex, gram, entry);
      }
    }
  }

  return {
    displayAliasToTickers,
    compactAliasToTickers,
    tickerToNames,
    aliasEntries,
    compactToEntries,
    compactBigramIndex,
    compactPrefixIndex,
    compactLengthIndex,
    displayCorpus: [...displayAliasToTickers.keys()],
    compactCorpus: [...compactAliasToTickers.keys()].filter(Boolean),
  };
}

function materializeCandidate({ ticker, score, via, recallRank, tickerToNames, tickerToInfo }) {
  const info = tickerToInfo[ticker] || {};
  return {
    ticker,
    score,
    via,
    recallRank,
    names: tickerToNames.get(ticker) || [],
    canonicalKo: info.name_ko || null,
    canonicalEn: info.name_en || null,
  };
}

function legacySortCandidates(a, b) {
  return (
    b.score - a.score ||
    Number(isLikelyPrimaryTicker(b.ticker)) - Number(isLikelyPrimaryTicker(a.ticker)) ||
    (a.canonicalKo || '').length - (b.canonicalKo || '').length ||
    a.ticker.localeCompare(b.ticker)
  );
}

function sortCandidates(a, b) {
  return (
    b.score - a.score ||
    Number(isLikelyPrimaryTicker(b.ticker)) - Number(isLikelyPrimaryTicker(a.ticker)) ||
    (a.recallRank ?? Number.MAX_SAFE_INTEGER) - (b.recallRank ?? Number.MAX_SAFE_INTEGER) ||
    (a.canonicalKo || '').length - (b.canonicalKo || '').length ||
    a.ticker.localeCompare(b.ticker)
  );
}

function addAliasToRecall(list, seen, alias) {
  if (!alias || seen.has(alias)) return;
  seen.add(alias);
  list.push(alias);
}

function addCompactMatches(list, seen, compactKey, compactToEntries) {
  for (const entry of compactToEntries.get(compactKey) || []) {
    addAliasToRecall(list, seen, entry.alias);
  }
}

function collectBaselineAliases(query, index) {
  const aliases = [];
  const seen = new Set();
  const qWithBracketTokens = exposeBracketedTokens(query);
  const qStripped = stripDecorators(query);
  const qWithBracketTokensCompact = compactText(qWithBracketTokens);
  const qCompact = compactText(qStripped);

  if (qWithBracketTokensCompact && qWithBracketTokensCompact !== qCompact) {
    addCompactMatches(aliases, seen, qWithBracketTokensCompact, index.compactToEntries);
  }

  if (qWithBracketTokens && qWithBracketTokens !== qStripped) {
    for (const alias of correctByDistance(qWithBracketTokens, index.displayCorpus, { distance: 2, maxSlice: 2, isSplit: false }).slice(0, 6)) {
      addAliasToRecall(aliases, seen, alias);
    }
  }

  if (qStripped) {
    for (const alias of correctByDistance(qStripped, index.displayCorpus, { distance: 4, maxSlice: 2, isSplit: false }).slice(0, 10)) {
      addAliasToRecall(aliases, seen, alias);
    }
  }

  if (qCompact) {
    for (const compactKey of correctByDistance(qCompact, index.compactCorpus, { distance: 4, maxSlice: 2, isSplit: false }).slice(0, 10)) {
      addCompactMatches(aliases, seen, compactKey, index.compactToEntries);
    }
  }

  return aliases;
}

function collectExpandedAliases(query, index) {
  const aliases = [];
  const seen = new Set();
  const qWithBracketTokens = exposeBracketedTokens(query);
  const qStripped = stripDecorators(query);
  const qWithBracketTokensCompact = compactText(qWithBracketTokens);
  const qCompact = compactText(qStripped || query);
  const qLen = qCompact.length;

  if (qWithBracketTokensCompact && qWithBracketTokensCompact !== qCompact) {
    addCompactMatches(aliases, seen, qWithBracketTokensCompact, index.compactToEntries);
  }

  if (qWithBracketTokens && qWithBracketTokens !== qStripped) {
    for (const alias of correctByDistance(qWithBracketTokens, index.displayCorpus, { distance: 2, maxSlice: 4, isSplit: false }).slice(0, 10)) {
      addAliasToRecall(aliases, seen, alias);
    }
  }

  for (const alias of collectBaselineAliases(query, index)) {
    addAliasToRecall(aliases, seen, alias);
  }

  if (qStripped) {
    for (const alias of correctByDistance(qStripped, index.displayCorpus, { distance: 4, maxSlice: 6, isSplit: false }).slice(0, 18)) {
      addAliasToRecall(aliases, seen, alias);
    }
  }

  if (qCompact) {
    for (const compactKey of correctByDistance(qCompact, index.compactCorpus, { distance: 4, maxSlice: 6, isSplit: false }).slice(0, 24)) {
      addCompactMatches(aliases, seen, compactKey, index.compactToEntries);
    }

    const addEntryList = (entries, maxLenDelta = 3) => {
      for (const entry of entries || []) {
        if (Math.abs((entry.compact?.length || 0) - qLen) <= maxLenDelta) {
          addAliasToRecall(aliases, seen, entry.alias);
        }
      }
    };

    for (const gram of charBigrams(qCompact)) {
      addEntryList(index.compactBigramIndex.get(gram), 3);
      if (aliases.length >= 48) break;
    }

    if (aliases.length < 40) {
      addEntryList(index.compactPrefixIndex.get(qCompact[0]), 2);
      for (let len = Math.max(1, qLen - 1); len <= qLen + 1; len += 1) {
        addEntryList(index.compactLengthIndex.get(String(len)), 1);
      }
    }
  }

  return aliases;
}

function rankAliases(query, aliases, index, tickerToInfo, topN, options = {}) {
  const scored = [];
  const seenAliasTicker = new Set();
  const useLegacyRanking = Boolean(options.useLegacyRanking);

  aliases.forEach((alias, recallRank) => {
    const tickers = new Set([
      ...(index.displayAliasToTickers.get(alias) || []),
      ...(index.compactAliasToTickers.get(compactText(alias)) || []),
    ]);

    for (const ticker of tickers) {
      const dedupeKey = `${ticker}::${alias}`;
      if (seenAliasTicker.has(dedupeKey)) continue;
      seenAliasTicker.add(dedupeKey);

      let score = useLegacyRanking ? baselineCandidateScore(query, alias) : candidateScore(query, alias);
      if (!isLikelyPrimaryTicker(ticker)) score -= 0.015;
      if (!useLegacyRanking && recallRank < 3) score += 0.012;
      else if (!useLegacyRanking && recallRank < 8) score += 0.006;

      scored.push(materializeCandidate({
        ticker,
        score: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
        via: alias,
        recallRank: useLegacyRanking ? undefined : recallRank,
        tickerToNames: index.tickerToNames,
        tickerToInfo,
      }));
    }
  });

  const ranked = scored.sort(useLegacyRanking ? legacySortCandidates : sortCandidates);
  return dedupeByTicker(ranked, topN);
}

function sanitizeTopN(value, fallback = 5) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(20, Math.trunc(value)));
}

function collectExactTickers(index, displayKeys, compactKeys) {
  const exactTickerSet = new Set();

  for (const key of displayKeys) {
    if (key && index.displayAliasToTickers.has(key)) {
      for (const ticker of index.displayAliasToTickers.get(key)) exactTickerSet.add(ticker);
    }
  }

  for (const key of compactKeys) {
    if (key && index.compactAliasToTickers.has(key)) {
      for (const ticker of index.compactAliasToTickers.get(key)) exactTickerSet.add(ticker);
    }
  }

  return exactTickerSet;
}

function createKoFuzzyResolver(options = {}) {
  const koMapPath = options.koMapPath || DEFAULT_KO_MAP_PATH;
  const tickerInfoPath = options.tickerInfoPath || DEFAULT_TICKER_INFO_PATH;

  const koNameToTicker = readJson(koMapPath);
  const tickerToInfo = readJson(tickerInfoPath);
  const index = buildIndex(koNameToTicker);

  function legacyResolve(query, topN = 5) {
    const qNorm = normalizeText(query);
    const qWithBracketTokens = exposeBracketedTokens(query);
    const qStripped = stripDecorators(query);
    const qCompact = compactText(query);
    const qWithBracketTokensCompact = compactText(qWithBracketTokens);
    const qStrippedCompact = compactText(qStripped);

    const bracketExactTickerSet =
      qWithBracketTokensCompact && qWithBracketTokensCompact !== qStrippedCompact
        ? collectExactTickers(index, [qWithBracketTokens], [qWithBracketTokensCompact])
        : new Set();
    const exactTickerSet =
      bracketExactTickerSet.size > 0
        ? bracketExactTickerSet
        : collectExactTickers(index, [qNorm, qStripped], [qCompact, qStrippedCompact]);

    if (exactTickerSet.size > 0) {
      const exactResults = [...exactTickerSet]
        .map((ticker) => materializeCandidate({
          ticker,
          score: 1,
          via: 'exact',
          recallRank: undefined,
          tickerToNames: index.tickerToNames,
          tickerToInfo,
        }))
        .sort(legacySortCandidates);
      return exactResults.slice(0, topN);
    }

    const fuzzyAliasSet = new Set();

    if (qStripped) {
      for (const alias of correctByDistance(qStripped, index.displayCorpus, { distance: 4, maxSlice: 2, isSplit: false }).slice(0, 10)) {
        fuzzyAliasSet.add(alias);
      }
    }

    if (qStrippedCompact) {
      for (const compactKey of correctByDistance(qStrippedCompact, index.compactCorpus, { distance: 4, maxSlice: 2, isSplit: false }).slice(0, 10)) {
        const tickers = index.compactAliasToTickers.get(compactKey);
        if (!tickers) continue;
        for (const ticker of tickers) {
          for (const name of index.tickerToNames.get(ticker) || []) {
            fuzzyAliasSet.add(name);
          }
        }
      }
    }

    const scored = [];
    const seenAliasTicker = new Set();
    for (const alias of fuzzyAliasSet) {
      const tickers = new Set([
        ...(index.displayAliasToTickers.get(alias) || []),
        ...(index.compactAliasToTickers.get(compactText(alias)) || []),
      ]);

      for (const ticker of tickers) {
        const dedupeKey = `${ticker}::${alias}`;
        if (seenAliasTicker.has(dedupeKey)) continue;
        seenAliasTicker.add(dedupeKey);

        let score = baselineCandidateScore(query, alias);
        if (!isLikelyPrimaryTicker(ticker)) score -= 0.015;

        scored.push(materializeCandidate({
          ticker,
          score: Number(Math.max(0, score).toFixed(4)),
          via: alias,
          recallRank: undefined,
          tickerToNames: index.tickerToNames,
          tickerToInfo,
        }));
      }
    }

    return dedupeByTicker(scored.sort(legacySortCandidates), topN);
  }

  function resolve(query, resolveOptions = {}) {
    const topN = sanitizeTopN(resolveOptions.topN ?? 5);
    const qNorm = normalizeText(query);
    const qWithBracketTokens = exposeBracketedTokens(query);
    const qStripped = stripDecorators(query);
    const qCompact = compactText(query);
    const qWithBracketTokensCompact = compactText(qWithBracketTokens);
    const qStrippedCompact = compactText(qStripped);

    const bracketExactTickerSet =
      qWithBracketTokensCompact && qWithBracketTokensCompact !== qStrippedCompact
        ? collectExactTickers(index, [qWithBracketTokens], [qWithBracketTokensCompact])
        : new Set();
    const exactTickerSet =
      bracketExactTickerSet.size > 0
        ? bracketExactTickerSet
        : collectExactTickers(index, [qNorm, qStripped], [qCompact, qStrippedCompact]);

    if (exactTickerSet.size > 0) {
      const exactResults = [...exactTickerSet]
        .map((ticker) => materializeCandidate({
          ticker,
          score: 1,
          via: 'exact',
          recallRank: -1,
          tickerToNames: index.tickerToNames,
          tickerToInfo,
        }))
        .sort(sortCandidates);
      return exactResults.slice(0, topN);
    }

    const expandedAliases = collectExpandedAliases(query, index);
    const baselineRanked = legacyResolve(query, Math.max(topN, 8));
    const expandedRanked = rankAliases(query, expandedAliases, index, tickerToInfo, Math.max(topN + 8, 16));

    if (baselineRanked.length === 0) {
      return expandedRanked.slice(0, topN);
    }

    const lockedTop1 = expandedRanked.find((item) => item.ticker === baselineRanked[0].ticker) || baselineRanked[0];
    const merged = [
      lockedTop1,
      ...expandedRanked.filter((item) => item.ticker !== lockedTop1.ticker),
    ];

    return merged.slice(0, topN);
  }

  return {
    koMapPath,
    tickerInfoPath,
    koNameToTicker,
    tickerToInfo,
    normalizeText,
    compactText,
    stripDecorators,
    resolve,
  };
}

module.exports = {
  DEFAULT_KO_MAP_PATH,
  DEFAULT_TICKER_INFO_PATH,
  normalizeText,
  compactText,
  stripDecorators,
  createKoFuzzyResolver,
};
