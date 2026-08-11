type RequestStore = { requestId: string }

let _als: { run<T>(_store: RequestStore, _fn: () => T): T; getStore(): RequestStore | undefined } | null = null
if (typeof window === 'undefined') {
  try {
    // eslint-disable-next-line no-undef
    const { AsyncLocalStorage } = require('node:async_hooks') as typeof import('async_hooks')
    _als = new AsyncLocalStorage<RequestStore>()
  } catch {

  }
}

export function withRequestId<T>(requestId: string, fn: () => T): T {
  if (_als) return _als.run({ requestId }, fn)
  return fn()
}

export function getRequestId(): string | undefined {
  return _als?.getStore()?.requestId
}

type Level = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  ts:         string
  level:      Level
  context:    string
  msg:        string
  requestId?: string
  data?:      unknown
}

const isProduction = process.env.NODE_ENV === 'production'

const debugEnabled = !isProduction || process.env.DEBUG_LOGS === 'true'

function format(entry: LogEntry): string {
  if (isProduction) {
    return JSON.stringify(entry)
  }
  const rid  = entry.requestId ? ` [${entry.requestId.slice(0, 8)}]` : ''
  const data = entry.data !== undefined ? ` ${JSON.stringify(entry.data)}` : ''
  return `${entry.ts} [${entry.level.toUpperCase()}]${rid} ${entry.context} — ${entry.msg}${data}`
}

function emit(level: Level, context: string, msg: string, data?: unknown): void {
  if (level === 'debug' && !debugEnabled) return

  const entry: LogEntry = {
    ts:        new Date().toISOString(),
    level,
    context,
    msg,
    requestId: getRequestId(),
    data,
  }
  const line = format(entry)

  if      (level === 'error') console.error(line)
  else if (level === 'warn')  console.warn(line)
  else if (level === 'debug') console.log(line) // eslint-disable-line no-console
  else                        console.log(line) // eslint-disable-line no-console
}

export function timer(): () => number {
  const start = performance.now()
  return () => Math.round(performance.now() - start)
}

export const logger = {
  debug: (context: string, msg: string, data?: unknown) => emit('debug', context, msg, data),
  info:  (context: string, msg: string, data?: unknown) => emit('info',  context, msg, data),
  warn:  (context: string, msg: string, data?: unknown) => emit('warn',  context, msg, data),
  error: (context: string, msg: string, data?: unknown) => emit('error', context, msg, data),
}

export function createLogger(context: string) {
  return {
    debug: (msg: string, data?: unknown) => emit('debug', context, msg, data),
    info:  (msg: string, data?: unknown) => emit('info',  context, msg, data),
    warn:  (msg: string, data?: unknown) => emit('warn',  context, msg, data),
    error: (msg: string, data?: unknown) => emit('error', context, msg, data),

    timer,
  }
}

export default logger
