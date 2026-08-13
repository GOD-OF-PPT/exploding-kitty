import type { FastifyServerOptions } from "fastify";

export type SafeLoggerOptions = NonNullable<Exclude<FastifyServerOptions["logger"], boolean>>;

/**
 * Builds the production logger policy without ever serializing request query data.
 * Query strings can contain invitation codes or future sensitive values. Keeping
 * them out of request logs is defense in depth; WSS bearers use a header and the
 * serializer intentionally never emits request headers.
 */
export function createSafeLoggerOptions(
  level: string,
  stream?: { write(message: string): void },
): SafeLoggerOptions {
  return {
    level,
    ...(stream ? { stream } : {}),
    serializers: {
      req(request) {
        const queryStart = request.url?.indexOf("?") ?? -1;
        return {
          method: request.method,
          url: queryStart < 0 ? request.url : request.url?.slice(0, queryStart),
          host: request.headers.host,
          remoteAddress: request.ip,
          remotePort: request.socket.remotePort,
        };
      },
    },
  };
}
