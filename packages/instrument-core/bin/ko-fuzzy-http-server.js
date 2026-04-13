#!/usr/bin/env node

const path = require('node:path');
const { createTickerSearchServer } = require('../src/ko-fuzzy-http-server');

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function readFlagValue(args, flagName, valueLabel) {
  const value = args.shift();
  if (!value || value.startsWith('--')) {
    fail(`${flagName} requires a ${valueLabel} argument`);
  }
  return value;
}

function readNumberFlagValue(args, flagName) {
  const value = readFlagValue(args, flagName, 'numeric');
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    fail(`${flagName} requires a numeric argument`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = [...argv];
  let port = 3040;
  let host = '0.0.0.0';
  let endpointPath = '/api/ticker-search';
  let unifiedEndpointPath = '/api/stock-search';
  let koMapPath;
  let tickerInfoPath;
  let krStockMapPath;

  while (args.length > 0) {
    const current = args.shift();
    if (current === '--port') {
      port = readNumberFlagValue(args, '--port');
      continue;
    }
    if (current === '--host') {
      host = readFlagValue(args, '--host', 'value');
      continue;
    }
    if (current === '--path') {
      endpointPath = readFlagValue(args, '--path', 'path');
      continue;
    }
    if (current === '--unified-path') {
      unifiedEndpointPath = readFlagValue(args, '--unified-path', 'path');
      continue;
    }
    if (current === '--ko-map') {
      koMapPath = path.resolve(readFlagValue(args, '--ko-map', 'path'));
      continue;
    }
    if (current === '--ticker-info') {
      tickerInfoPath = path.resolve(readFlagValue(args, '--ticker-info', 'path'));
      continue;
    }
    if (current === '--kr-stock-map') {
      krStockMapPath = path.resolve(readFlagValue(args, '--kr-stock-map', 'path'));
      continue;
    }
  }

  return { port, host, endpointPath, unifiedEndpointPath, koMapPath, tickerInfoPath, krStockMapPath };
}

const { port, host, endpointPath, unifiedEndpointPath, koMapPath, tickerInfoPath, krStockMapPath } = parseArgs(process.argv.slice(2));

let server;
try {
  server = createTickerSearchServer({ endpointPath, unifiedEndpointPath, koMapPath, tickerInfoPath, krStockMapPath });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

server.listen(port, host, () => {
  console.log(JSON.stringify({ ok: true, host, port, endpointPath, unifiedEndpointPath }, null, 2));
});
