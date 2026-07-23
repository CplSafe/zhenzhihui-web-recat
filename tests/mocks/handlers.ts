import type { RequestHandler } from 'msw'

/** Shared deterministic API handlers. Individual tests may add scenario-specific handlers with server.use(). */
export const handlers: RequestHandler[] = []
