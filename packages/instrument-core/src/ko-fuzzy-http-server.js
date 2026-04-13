const http = require('node:http');
const { URL } = require('node:url');
const { createKoFuzzyResolver } = require('./ko-fuzzy-resolver');
const { createKrStockResolver } = require('./kr-stock-resolver');

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload, null, 2));
}

function sanitizeTopN(value) {
  return Number.isFinite(value) ? Math.max(1, Math.min(20, Math.trunc(value))) : 5;
}

function readQueryParams(requestUrl) {
  const query = (requestUrl.searchParams.get('q') || requestUrl.searchParams.get('query') || '').trim();
  const topNParam = Number(requestUrl.searchParams.get('topN') || requestUrl.searchParams.get('limit') || '5');
  const topN = sanitizeTopN(topNParam);
  return { query, topN };
}

function emptyKrResult() {
  return {
    matched: false,
    matchedBy: null,
    name: null,
    code: null,
  };
}

function normalizeEndpointPath(value, label) {
  const rawValue = String(value).trim();
  if (!rawValue) {
    throw new Error(`${label} must not be empty`);
  }

  const trimmed = rawValue.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '/';
}

function createTickerSearchServer(options = {}) {
  const usResolver = createKoFuzzyResolver(options);
  let krResolver = null;
  let krResolverError = null;
  const getKrResolver = () => {
    if (krResolverError) {
      throw krResolverError;
    }
    if (!krResolver) {
      try {
        krResolver = createKrStockResolver({ krStockMapPath: options.krStockMapPath });
      } catch (error) {
        krResolverError = error;
        throw error;
      }
    }
    return krResolver;
  };
  const endpointPath = normalizeEndpointPath(options.endpointPath || '/api/ticker-search', 'endpointPath');
  const unifiedEndpointPath = normalizeEndpointPath(options.unifiedEndpointPath || '/api/stock-search', 'unifiedEndpointPath');

  if (endpointPath === unifiedEndpointPath) {
    throw new Error('endpoint paths must be distinct');
  }

  if (endpointPath === '/health' || unifiedEndpointPath === '/health') {
    throw new Error('endpoint paths must not reuse /health');
  }

  return http.createServer((req, res) => {
    try {
      const method = req.method || 'GET';
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');

      if (method === 'GET' && requestUrl.pathname === '/health') {
        writeJson(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && requestUrl.pathname === endpointPath) {
        const { query, topN } = readQueryParams(requestUrl);
        if (!query) {
          writeJson(res, 400, { error: 'query is required' });
          return;
        }

        const results = usResolver.resolve(query, { topN });
        writeJson(res, 200, {
          query,
          topN,
          results,
        });
        return;
      }

      if (method === 'GET' && requestUrl.pathname === unifiedEndpointPath) {
        const { query, topN } = readQueryParams(requestUrl);
        if (!query) {
          writeJson(res, 400, { error: 'query is required' });
          return;
        }

        let krResult = emptyKrResult();
        try {
          krResult = getKrResolver().resolve(query) || emptyKrResult();
        } catch {
          krResult = emptyKrResult();
        }

        const usResults = krResult.matched ? [] : usResolver.resolve(query, { topN });

        writeJson(res, 200, {
          query,
          topN,
          kr: krResult,
          us: {
            results: usResults,
          },
        });
        return;
      }

      writeJson(res, 404, { error: 'not found' });
    } catch (error) {
      if (error instanceof TypeError && error.message === 'Invalid URL') {
        writeJson(res, 400, { error: 'invalid url' });
        return;
      }
      writeJson(res, 500, { error: 'internal error' });
    }
  });
}

module.exports = {
  createTickerSearchServer,
};
