type LogMethod = (...args: unknown[]) => void;

const noop: LogMethod = () => {};
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

export const logger = {
  log: (isDev ? console.log : noop) as LogMethod,
  warn: (isDev ? console.warn : noop) as LogMethod,
  debug: (isDev ? console.debug : noop) as LogMethod,
  error: console.error as LogMethod,
};

export function configureLogger(): void {
  if (isDev) return;

  console.log = noop as typeof console.log;
  console.warn = noop as typeof console.warn;
  console.debug = noop as typeof console.debug;
}
