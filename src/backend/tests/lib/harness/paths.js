const path = require('path');

// This file lives at tests/lib/harness/paths.js. Three levels up is 'src/backend'.
const backendRoot = path.resolve(__dirname, '..', '..', '..');
const distRoot = path.join(backendRoot, 'dist/backend');
const dataUsersRoot = path.resolve(backendRoot, '..', '..', 'data/users');

function requireBackend(relativePath) {
  // Always resolve from compiled dist to keep parity with production build
  // relativePath like 'server.js', 'utils/paths.js'
  // NOTE: callers must ensure `npm run build` executed before running tests
  // to populate dist/backend/**.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(distRoot, relativePath));
}

module.exports = {
  backendRoot,
  distRoot,
  dataUsersRoot,
  requireBackend,
};
