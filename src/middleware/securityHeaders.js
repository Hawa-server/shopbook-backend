// Sets the security headers on every response (written in the project, no
// library). Each one closes a specific door:
// - X-Content-Type-Options: nosniff  → the browser won't guess a file type
//   and run something as a script that wasn't meant to be one;
// - X-Frame-Options: DENY            → no other site can show the API in a frame;
// - Referrer-Policy: no-referrer     → addresses (which could hold a token) are
//   never passed on to other sites;
// - Strict-Transport-Security        → production only: browsers must use HTTPS;
// - Cache-Control: no-store on /api  → business data is never kept in a shared
//   or browser cache (the phone keeps its own copy in its database instead).

// Makes the middleware; `isProduction` decides whether HSTS is sent (on
// localhost over plain HTTP it would only cause trouble).
function securityHeaders({ isProduction }) {
  return function setSecurityHeaders(req, res, next) {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    if (isProduction) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.path === '/api' || req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  };
}

module.exports = { securityHeaders };
