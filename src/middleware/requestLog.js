// Writes one structured log line per request when its response finishes:
// time, request ID, method, path (never the query string, which could hold
// something private), status, duration, and the user and business IDs once
// sign-in exists (BE2/BE3). Bodies, headers and cookies are never logged.

// Makes the middleware. With `logProxyChain` on (LOG_PROXY_CHAIN=true, used
// once in BE1 Part B), it also logs req.ip and the X-Forwarded-For chain, so
// the number of proxies in front (Vercel, Render) can be counted and
// `trust proxy` set correctly. Turn it off again afterwards: IPs are personal data.
function requestLog({ logger, logProxyChain = false }) {
  return function logRequest(req, res, next) {
    const started = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      logger.info('request', {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        userId: req.user?.id,
        businessId: req.business?.id,
      });

      if (logProxyChain) {
        const chain = (req.get('X-Forwarded-For') ?? '').split(',').map((part) => part.trim()).filter(Boolean);
        logger.info('proxy_chain', {
          requestId: req.id,
          ip: req.ip,
          socketAddress: req.socket.remoteAddress,
          forwardedFor: chain,
          forwardedHops: chain.length,
        });
      }
    });

    next();
  };
}

module.exports = { requestLog };
