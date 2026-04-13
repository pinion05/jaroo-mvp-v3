const fs = require('node:fs');
const path = require('node:path');
const { normalizeText, compactText } = require('./ko-fuzzy-resolver');

const DEFAULT_KR_STOCK_MAP_PATH = path.resolve(__dirname, '../data/kr/kr-stock-name-to-code.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function pushEntry(map, key, entry) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(entry);
}

function createKrStockResolver(options = {}) {
  const krStockMapPath = options.krStockMapPath || DEFAULT_KR_STOCK_MAP_PATH;
  const krNameToCode = readJson(krStockMapPath);
  const normalizedNameToEntries = new Map();
  const compactNameToEntries = new Map();

  for (const [name, code] of Object.entries(krNameToCode)) {
    const normalizedName = normalizeText(name);
    const compactName = compactText(name);
    const entry = { name, code };

    pushEntry(normalizedNameToEntries, normalizedName, entry);
    pushEntry(compactNameToEntries, compactName, entry);
  }

  function resolve(query) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return null;

    const normalizedMatches = normalizedNameToEntries.get(normalizedQuery) || [];
    if (normalizedMatches.length > 0) {
      return {
        ...normalizedMatches[0],
        matched: true,
        matchedBy: 'exact',
      };
    }

    const compactQuery = compactText(query);
    if (!compactQuery) return null;

    const compactMatches = compactNameToEntries.get(compactQuery) || [];
    if (compactMatches.length !== 1) {
      return null;
    }

    return {
      ...compactMatches[0],
      matched: true,
      matchedBy: 'compact',
    };
  }

  return {
    krStockMapPath,
    krNameToCode,
    resolve,
  };
}

module.exports = {
  DEFAULT_KR_STOCK_MAP_PATH,
  createKrStockResolver,
};
