const fs = require('fs');
const path = require('path');

function resolveDataDir() {
  const envDir = process.env.VX_MAILAGENT_DATA_DIR;
  if (typeof envDir === 'string' && envDir.trim() !== '') {
    return path.resolve(envDir.trim());
  }

  const candidates = [
    path.resolve(__dirname, '../../../../data'),
    path.resolve(process.cwd(), 'data'),
  ];

  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) {
        return candidate;
      }
    } catch (error) {
      // Ignore and continue searching.
    }
  }

  return candidates[0];
}

function discoverTestUserId() {
  const dataDir = resolveDataDir();
  const usersDir = path.join(dataDir, 'users');
  let entries;
  try {
    entries = fs.readdirSync(usersDir, { withFileTypes: true });
  } catch (error) {
    return null;
  }

  const sortedDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  for (const dirName of sortedDirs) {
    const markerPath = path.join(usersDir, dirName, '.testuser');
    try {
      const stat = fs.statSync(markerPath);
      if (stat.isFile()) {
        try {
          const contents = fs.readFileSync(markerPath, 'utf8').toString().trim();
          if (contents) {
            return contents;
          }
        } catch {
          // Ignore read errors and use directory name fallback.
        }
        return dirName;
      }
    } catch {
      // Marker absent; continue searching.
    }
  }

  return null;
}

module.exports = {
  resolveDataDir,
  discoverTestUserId,
};
