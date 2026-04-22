const EMOJI = {
    info: 'ℹ️',
    start: '🚀',
    done: '✅',
    warn: '⚠️',
    error: '❌',
    section: '🧩',
    retry: '🔁',
    summary: '📊'
};

function format(emoji, scope, message) {
    return `${emoji} [${scope}] ${message}`;
}

function logWith(method, emoji, scope, message) {
    const text = format(emoji, scope, message);
    method(text);
}

function info(scope, message) {
    logWith(console.log, EMOJI.info, scope, message);
}

function start(scope, message) {
    logWith(console.log, EMOJI.start, scope, message);
}

function done(scope, message) {
    logWith(console.log, EMOJI.done, scope, message);
}

function warn(scope, message) {
    logWith(console.warn, EMOJI.warn, scope, message);
}

function error(scope, message) {
    logWith(console.error, EMOJI.error, scope, message);
}

function retry(scope, message) {
    logWith(console.warn, EMOJI.retry, scope, message);
}

function summary(scope, message) {
    logWith(console.log, EMOJI.summary, scope, message);
}

function section(scope, message) {
    console.log(`\n${format(EMOJI.section, scope, message)}`);
}

module.exports = {
    info,
    start,
    done,
    warn,
    error,
    retry,
    summary,
    section
};
