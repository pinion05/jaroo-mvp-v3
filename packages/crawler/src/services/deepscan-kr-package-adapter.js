import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10;
const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_CACHE_DIR = path.join(os.tmpdir(), 'jaroo-deepscan-kr-package-cache');
const DEFAULT_SNAPSHOT_DIR = path.join(os.tmpdir(), 'jaroo-deepscan-kr-package-snapshots');
const DEEP_SCAN_KR_PACKAGE_RESULT_KEYS = Object.freeze([
  'stockCode',
  'reportContent',
  'timestamp',
  'listingMarket',
  'marketScoreSnapshot',
  'boardAnalysis',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEnv(name, fallback) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizePositiveNumericString(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }

    return String(value);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || !/^(?:\d+|\d+\.\d+)$/.test(normalized)) {
    return null;
  }

  return Number(normalized) > 0 ? normalized : null;
}

function normalizeStockCode(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return /^\d{6}$/.test(normalized) ? normalized : null;
}

function normalizeSshHost(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized.startsWith('-') || /\s/.test(normalized)) {
    return null;
  }

  return /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+$/.test(normalized) ? normalized : null;
}

function normalizeAbsolutePath(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || !path.isAbsolute(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeAbsolutePosixPath(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || !path.posix.isAbsolute(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeNodeBin(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized.startsWith('-') || /\s/.test(normalized)) {
    return null;
  }

  if (normalized.includes('/')) {
    return path.posix.isAbsolute(normalized) ? normalized : null;
  }

  return /^[A-Za-z0-9._-]+$/.test(normalized) ? normalized : null;
}

function quoteForPosixShell(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function extractStructuredJsonCandidates(text) {
  const candidates = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (char === '\\') {
        isEscaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (start === -1) {
      if (char === '{' || char === '[') {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (char === '{' || char === '[') {
      depth += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      depth -= 1;

      if (depth === 0) {
        candidates.push(text.slice(start, index + 1).trim());
        start = -1;
      }
    }
  }

  return candidates.filter(Boolean);
}

function normalizeOptions(options = {}) {
  const safeOptions = options && typeof options === 'object' ? options : {};
  const timeoutMs = safeOptions.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : Number(safeOptions.timeoutMs);
  const maxRetries = safeOptions.maxRetries === undefined ? DEFAULT_MAX_RETRIES : Number(safeOptions.maxRetries);
  const retryDelayMs = safeOptions.retryDelayMs === undefined ? DEFAULT_RETRY_DELAY_MS : Number(safeOptions.retryDelayMs);
  const connectTimeoutSeconds = safeOptions.connectTimeoutSeconds === undefined
    ? DEFAULT_CONNECT_TIMEOUT_SECONDS
    : Number(safeOptions.connectTimeoutSeconds);
  const cacheTtlMs = safeOptions.cacheTtlMs === undefined ? DEFAULT_CACHE_TTL_MS : Number(safeOptions.cacheTtlMs);
  const enableCache = safeOptions.enableCache !== false;
  const enableSnapshots = safeOptions.enableSnapshots !== false;

  const errors = [];

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    errors.push('timeoutMs must be a positive integer when provided');
  }

  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    errors.push('maxRetries must be a non-negative integer when provided');
  }

  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) {
    errors.push('retryDelayMs must be a non-negative integer when provided');
  }

  if (!Number.isInteger(connectTimeoutSeconds) || connectTimeoutSeconds <= 0) {
    errors.push('connectTimeoutSeconds must be a positive integer when provided');
  }

  if (enableCache && (!Number.isInteger(cacheTtlMs) || cacheTtlMs <= 0)) {
    errors.push('cacheTtlMs must be a positive integer when provided');
  }

  return {
    errors,
    timeoutMs,
    maxRetries,
    retryDelayMs,
    connectTimeoutSeconds,
    cacheTtlMs,
    enableCache,
    enableSnapshots,
    cacheDir: safeOptions.cacheDir ?? readEnv('DEEPSCAN_KR_PACKAGE_CACHE_DIR', DEFAULT_CACHE_DIR),
    snapshotDir: safeOptions.snapshotDir ?? readEnv('DEEPSCAN_KR_PACKAGE_SNAPSHOT_DIR', DEFAULT_SNAPSHOT_DIR),
    sshHost: safeOptions.sshHost ?? readEnv('DEEPSCAN_KR_PACKAGE_SSH_HOST'),
    identityPath: safeOptions.identityPath ?? readEnv('DEEPSCAN_KR_PACKAGE_SSH_IDENTITY'),
    knownHostsPath: safeOptions.knownHostsPath ?? readEnv('DEEPSCAN_KR_PACKAGE_SSH_KNOWN_HOSTS'),
    remoteDir: safeOptions.remoteDir ?? readEnv('DEEPSCAN_KR_PACKAGE_REMOTE_DIR'),
    nodeBin: safeOptions.nodeBin ?? readEnv('DEEPSCAN_KR_PACKAGE_NODE_BIN', readEnv('DEEPSCAN_KR_PACKAGE_NODE_PATH', 'node')),
    execFile: safeOptions.execFile,
  };
}

function createInvalidInputResult(details) {
  return {
    ok: false,
    error: {
      code: 'invalid-input',
      message: 'invalid DeepScan KR package input',
      retryable: false,
      details,
    },
  };
}

function buildInvocationSshMeta(commandResult) {
  return {
    host: commandResult.ssh.host,
    remoteDir: commandResult.ssh.remoteDir,
    nodeBin: commandResult.ssh.nodeBin,
    connectTimeoutSeconds: commandResult.ssh.connectTimeoutSeconds,
  };
}

function isStructuredPayloadObject(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length > 0,
  );
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidTimestampString(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function buildCacheKey(input, commandResult) {
  return createHash('sha256')
    .update(JSON.stringify({
      input,
      ssh: buildInvocationSshMeta(commandResult),
    }))
    .digest('hex');
}

function isDeepScanKrPackagePayload(data) {
  const normalizedStockCode = normalizeStockCode(data?.stockCode);
  return Boolean(
    data
    && typeof data === 'object'
    && !Array.isArray(data)
    && normalizedStockCode
    && isNonEmptyString(data.reportContent)
    && isValidTimestampString(data.timestamp)
    && isStructuredPayloadObject(data.marketScoreSnapshot)
    && isStructuredPayloadObject(data.boardAnalysis)
    && isNonEmptyString(data.listingMarket)
    && Object.hasOwn(data, 'listingMarket')
    && Object.hasOwn(data, 'marketScoreSnapshot')
    && Object.hasOwn(data, 'boardAnalysis')
    && DEEP_SCAN_KR_PACKAGE_RESULT_KEYS.every((key) => Object.hasOwn(data, key)),
  );
}

async function ensureDirectory(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

function buildPublicMeta(commandResult, extra = {}) {
  return {
    attemptCount: extra.attemptCount ?? 0,
    timeoutMs: commandResult.timeoutMs,
    command: commandResult.command,
    ...(extra.cache ? { cache: extra.cache } : {}),
    ...(Object.hasOwn(extra, 'exitCode') ? { exitCode: extra.exitCode } : {}),
    ...(Object.hasOwn(extra, 'signal') ? { signal: extra.signal } : {}),
  };
}

async function readCacheResult(commandResult) {
  if (!commandResult.cache?.enabled) {
    return null;
  }

  try {
    const fileStat = await stat(commandResult.cache.filePath);
    if ((Date.now() - fileStat.mtimeMs) > commandResult.cache.ttlMs) {
      return null;
    }

    const cachedText = await readFile(commandResult.cache.filePath, 'utf8');
    const cached = JSON.parse(cachedText);
    if (!cached || cached.ok !== true || !isDeepScanKrPackagePayload(cached.data)) {
      return null;
    }
    if (cached.data.stockCode !== commandResult.input.stockCode) {
      return null;
    }

    return {
      ok: true,
      data: cached.data,
      meta: buildPublicMeta(commandResult, {
        cache: {
          hit: true,
          ttlMs: commandResult.cache.ttlMs,
        },
      }),
    };
  } catch {
    return null;
  }
}

async function writeCacheResult(commandResult, payload) {
  if (!commandResult.cache?.enabled || !payload?.ok) {
    return;
  }

  try {
    await ensureDirectory(commandResult.cache.dirPath);
    await writeFile(commandResult.cache.filePath, JSON.stringify({
      ok: true,
      data: payload.data,
      cachedAt: new Date().toISOString(),
    }, null, 2));
  } catch {
    // cache persistence is best-effort only
  }
}

async function writeSnapshot(commandResult, snapshot) {
  if (!commandResult.snapshot?.enabled) {
    return null;
  }

  try {
    await ensureDirectory(commandResult.snapshot.dirPath);
    const fileName = `${Date.now()}-${commandResult.cache.key}-attempt-${snapshot.attemptCount}-${snapshot.kind}.json`;
    const filePath = path.join(commandResult.snapshot.dirPath, fileName);
    await writeFile(filePath, JSON.stringify(snapshot, null, 2));
    return filePath;
  } catch {
    return null;
  }
}

function createRemoteInlineScript() {
  return [
    "import { generateInvestmentReport } from './src/package.js';",
    "const input = JSON.parse(Buffer.from(process.argv[1], 'base64').toString('utf8'));",
    'const result = await generateInvestmentReport(input);',
    "process.stdout.write(`${JSON.stringify(result)}\\n`);",
  ].join(' ');
}

export function buildDeepScanKrPackageCommand(input, options = {}) {
  const safeInput = input && typeof input === 'object' ? input : {};
  const normalizedInput = {
    stockCode: normalizeStockCode(safeInput.stockCode),
    holdingQty: normalizePositiveNumericString(safeInput.holdingQty),
    avgPrice: normalizePositiveNumericString(safeInput.avgPrice),
  };
  const normalizedOptions = normalizeOptions(options);
  const validationErrors = [...normalizedOptions.errors];

  if (!normalizedInput.stockCode) {
    validationErrors.push('stockCode must be a 6-digit KR stock code string');
  }

  if (!normalizedInput.holdingQty) {
    validationErrors.push('holdingQty must be a positive numeric string or number');
  }

  if (!normalizedInput.avgPrice) {
    validationErrors.push('avgPrice must be a positive numeric string or number');
  }

  const normalizedSshHost = normalizeSshHost(normalizedOptions.sshHost);
  if (!normalizedSshHost) {
    validationErrors.push('sshHost must be a non-empty ssh destination without whitespace or option-like prefixes');
  }

  const normalizedIdentityPath = normalizeAbsolutePath(normalizedOptions.identityPath);
  if (!normalizedIdentityPath) {
    validationErrors.push('identityPath must be a non-empty absolute path string');
  }

  const normalizedKnownHostsPath = normalizeAbsolutePath(normalizedOptions.knownHostsPath);
  if (!normalizedKnownHostsPath) {
    validationErrors.push('knownHostsPath must be a non-empty absolute path string');
  }

  const normalizedRemoteDir = normalizeAbsolutePosixPath(normalizedOptions.remoteDir);
  if (!normalizedRemoteDir) {
    validationErrors.push('remoteDir must be a non-empty absolute POSIX path string');
  }

  const normalizedNodeBin = normalizeNodeBin(normalizedOptions.nodeBin);
  if (!normalizedNodeBin) {
    validationErrors.push('nodeBin must be a non-empty executable name or absolute path string');
  }

  const normalizedCacheDir = normalizeAbsolutePath(normalizedOptions.cacheDir);
  if (!normalizedCacheDir) {
    validationErrors.push('cacheDir must be a non-empty absolute path string when provided');
  }

  const normalizedSnapshotDir = normalizeAbsolutePath(normalizedOptions.snapshotDir);
  if (!normalizedSnapshotDir) {
    validationErrors.push('snapshotDir must be a non-empty absolute path string when provided');
  }

  if (validationErrors.length > 0) {
    return createInvalidInputResult(validationErrors);
  }

  const payloadBase64 = Buffer.from(JSON.stringify(normalizedInput), 'utf8').toString('base64');
  const remoteCommand = [
    `cd ${quoteForPosixShell(normalizedRemoteDir)}`,
    `${quoteForPosixShell(normalizedNodeBin)} --input-type=module -e ${quoteForPosixShell(createRemoteInlineScript())} -- ${quoteForPosixShell(payloadBase64)}`,
  ].join(' && ');
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${normalizedOptions.connectTimeoutSeconds}`,
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    `UserKnownHostsFile=${normalizedKnownHostsPath}`,
    '-i',
    normalizedIdentityPath,
    normalizedSshHost,
    remoteCommand,
  ];

  const cacheKey = buildCacheKey(normalizedInput, {
    ssh: {
      host: normalizedSshHost,
      remoteDir: normalizedRemoteDir,
      nodeBin: normalizedNodeBin,
      connectTimeoutSeconds: normalizedOptions.connectTimeoutSeconds,
    },
  });

  return {
    ok: true,
    command: 'ssh',
    args,
    execFileOptions: {
      timeout: normalizedOptions.timeoutMs,
      maxBuffer: DEFAULT_MAX_BUFFER_BYTES,
    },
    input: normalizedInput,
    timeoutMs: normalizedOptions.timeoutMs,
    maxRetries: normalizedOptions.maxRetries,
    retryDelayMs: normalizedOptions.retryDelayMs,
    remoteCommand,
    cache: {
      enabled: normalizedOptions.enableCache,
      key: cacheKey,
      ttlMs: normalizedOptions.cacheTtlMs,
      dirPath: normalizedCacheDir,
      filePath: path.join(normalizedCacheDir, `${cacheKey}.json`),
    },
    snapshot: {
      enabled: normalizedOptions.enableSnapshots,
      dirPath: normalizedSnapshotDir,
    },
    ssh: {
      host: normalizedSshHost,
      identityPath: normalizedIdentityPath,
      knownHostsPath: normalizedKnownHostsPath,
      remoteDir: normalizedRemoteDir,
      nodeBin: normalizedNodeBin,
      connectTimeoutSeconds: normalizedOptions.connectTimeoutSeconds,
    },
  };
}

export function parseDeepScanKrPackageStdout(stdout) {
  const rawStdout = typeof stdout === 'string' ? stdout : String(stdout ?? '');
  const trimmedStdout = rawStdout.trim();

  if (!trimmedStdout) {
    return {
      ok: false,
      error: {
        code: 'empty-stdout',
        message: 'remote package returned empty stdout',
        retryable: true,
      },
    };
  }

  const candidates = [trimmedStdout, ...extractStructuredJsonCandidates(trimmedStdout)];
  const seen = new Set();

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (!candidate || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);

    try {
      const data = JSON.parse(candidate);
      if (!isDeepScanKrPackagePayload(data)) {
        continue;
      }

      return {
        ok: true,
        data,
        jsonText: candidate,
      };
    } catch {
      // try the next candidate
    }
  }

  return {
    ok: false,
    error: {
      code: 'parse-failed',
      message: 'failed to extract structured JSON from remote package stdout',
      retryable: true,
    },
  };
}

function isRetryableInvocationFailure(error) {
  const combined = [error?.message, error?.stderr, error?.stdout]
    .filter(Boolean)
    .join('\n');

  if (/permission denied/i.test(combined)) return false;
  if (/host key verification failed/i.test(combined)) return false;
  if (/could not resolve hostname/i.test(combined)) return false;
  if (/identity file .* not accessible/i.test(combined)) return false;
  if (/module not found/i.test(combined)) return false;
  if (/err_module_not_found/i.test(combined)) return false;
  if (/cannot find module/i.test(combined)) return false;
  if (/not a git repository/i.test(combined)) return false;

  return true;
}

function mapInvocationError(error, timeoutMs, attemptCount, commandResult) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
  const message = typeof error?.message === 'string' && error.message ? error.message : 'remote package invocation failed';
  const isTimeout = Boolean(error?.killed)
    || /timed out/i.test(message)
    || /timed out/i.test(stderr)
    || error?.code === 'ETIMEDOUT';
  const retryable = isTimeout ? true : isRetryableInvocationFailure(error);

  return {
    ok: false,
    error: {
      code: isTimeout ? 'timeout' : 'remote-invocation-failed',
      message: isTimeout
        ? `DeepScan KR package invocation timed out after ${timeoutMs}ms`
        : 'DeepScan KR package invocation failed',
      retryable,
    },
    meta: buildPublicMeta(commandResult, {
      attemptCount,
      exitCode: error?.code ?? null,
      signal: error?.signal ?? null,
    }),
  };
}

export async function invokeDeepScanKrPackage(input, options = {}) {
  const commandResult = buildDeepScanKrPackageCommand(input, options);
  if (!commandResult.ok) {
    return {
      ...commandResult,
      meta: {
        attemptCount: 0,
      },
    };
  }

  const normalizedOptions = normalizeOptions(options);
  const execFileImpl = typeof normalizedOptions.execFile === 'function' ? normalizedOptions.execFile : execFile;
  const cachedResult = await readCacheResult(commandResult);
  if (cachedResult) {
    return cachedResult;
  }

  let lastFailure = null;

  for (let attempt = 0; attempt <= commandResult.maxRetries; attempt += 1) {
    const attemptCount = attempt + 1;

    try {
      const result = await execFileImpl(commandResult.command, commandResult.args, commandResult.execFileOptions);
      const stdout = typeof result === 'string' ? result : result?.stdout ?? '';
      const parsed = parseDeepScanKrPackageStdout(stdout);

      if (parsed.ok) {
        if (parsed.data.stockCode !== commandResult.input.stockCode) {
          lastFailure = {
            ok: false,
            error: {
              code: 'stock-code-mismatch',
              message: `remote package returned stockCode ${parsed.data.stockCode} for requested ${commandResult.input.stockCode}`,
              retryable: false,
            },
            meta: buildPublicMeta(commandResult, {
              attemptCount,
            }),
          };
          await writeSnapshot(commandResult, {
            kind: 'stock-code-mismatch',
            attemptCount,
            input: commandResult.input,
            parsedData: parsed.data,
            error: lastFailure.error,
            generatedAt: new Date().toISOString(),
          });
        } else {
          const successResult = {
            ok: true,
            data: parsed.data,
            meta: buildPublicMeta(commandResult, {
              attemptCount,
              cache: {
                hit: false,
                ttlMs: commandResult.cache.ttlMs,
              },
            }),
          };
          await writeCacheResult(commandResult, successResult);
          await writeSnapshot(commandResult, {
            kind: 'success',
            attemptCount,
            input: commandResult.input,
            parsedData: parsed.data,
            generatedAt: new Date().toISOString(),
          });
          return successResult;
        }
      } else {
        lastFailure = {
          ok: false,
          error: parsed.error,
          meta: buildPublicMeta(commandResult, {
            attemptCount,
          }),
        };
        await writeSnapshot(commandResult, {
          kind: 'parse-failed',
          attemptCount,
          input: commandResult.input,
          error: lastFailure.error,
          generatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      lastFailure = mapInvocationError(error, commandResult.timeoutMs, attemptCount, commandResult);
      await writeSnapshot(commandResult, {
        kind: 'invocation-failed',
        attemptCount,
        input: commandResult.input,
        error: lastFailure.error,
        generatedAt: new Date().toISOString(),
      });
    }

    if (!lastFailure?.error?.retryable) {
      break;
    }

    if (attempt < commandResult.maxRetries) {
      await sleep(commandResult.retryDelayMs);
    }
  }

  return lastFailure ?? {
    ok: false,
    error: {
      code: 'remote-invocation-failed',
      message: 'DeepScan KR package invocation failed without a captured error',
      retryable: true,
    },
    meta: buildPublicMeta(commandResult, {
      attemptCount: commandResult.maxRetries + 1,
    }),
  };
}
