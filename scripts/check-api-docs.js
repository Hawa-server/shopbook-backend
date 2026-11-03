// `npm run check:api-docs`: makes sure docs/api.md and the server agree. Every
// route in the registry (src/routes/index.js) must have a `### METHOD /path`
// heading in docs/api.md, and every such heading must be a real route. The
// frontend is built only from api.md, so a missing or stale entry would make
// the app call something that isn't there. From BE5 it also compares the sync
// operation types. Runs as part of `npm test`.

const fs = require('node:fs');
const path = require('node:path');

const API_DOCS = path.resolve(__dirname, '../docs/api.md');
const HEADING = /^###\s+(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)\s*$/;

// Reads the `### METHOD /path` headings from the markdown text.
function documentedRoutes(markdown) {
  const found = new Set();
  for (const line of markdown.split('\n')) {
    const match = HEADING.exec(line.trim());
    if (match) found.add(`${match[1]} ${match[2].replace(/`/g, '')}`);
  }
  return found;
}

// Compares the registry with the docs; returns what's missing on each side.
function compareRoutes({ routes, markdown }) {
  const inCode = new Set(routes.map((route) => `${route.method} ${route.path}`));
  const inDocs = documentedRoutes(markdown);
  return {
    missingInDocs: [...inCode].filter((route) => !inDocs.has(route)),
    missingInCode: [...inDocs].filter((route) => !inCode.has(route)),
  };
}

// Command-line use: print the result and exit 1 when anything differs.
function main() {
  const { routes } = require('../src/routes');
  const markdown = fs.readFileSync(API_DOCS, 'utf8');
  const { missingInDocs, missingInCode } = compareRoutes({ routes, markdown });

  if (missingInDocs.length === 0 && missingInCode.length === 0) {
    process.stdout.write(`check:api-docs: OK (${routes.length} routes documented)\n`);
    return;
  }
  for (const route of missingInDocs) process.stderr.write(`Route not in docs/api.md: ${route}\n`);
  for (const route of missingInCode) process.stderr.write(`In docs/api.md but no such route: ${route}\n`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = { compareRoutes, documentedRoutes };
