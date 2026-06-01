// Thin pino-schema event emitter — Tier-1 of the observability design. Owned,
// and swappable for pino-bare later. One JSON object per line:
//   {level, time, ...context, ...fields, msg}
// Levels: trace/debug/info/warn/error. Default threshold is info (production);
// pass --debug on the command line to dial up (the first escalation lever; env
// access isn't built into Bare yet, so a flag stands in for LOG_LEVEL for now).
// `.child(ctx)` binds context (e.g. a correlation id) onto every line it emits.
const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 }

const dialDebug = typeof Bare !== 'undefined' && Bare.argv && Bare.argv.includes('--debug')
const threshold = dialDebug ? LEVELS.debug : LEVELS.info

function make (context = {}) {
  const log = {}
  for (const lvl in LEVELS) {
    const value = LEVELS[lvl]
    log[lvl] = function (fields, msg) {
      if (value < threshold) return
      if (typeof fields === 'string') { msg = fields; fields = {} }
      console.log(JSON.stringify({ level: value, time: Date.now(), ...context, ...fields, msg }))
    }
  }
  log.child = (extra) => make({ ...context, ...extra })
  return log
}

module.exports = make
