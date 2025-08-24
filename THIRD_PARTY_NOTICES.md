# Third-Party Notices and Attributions

This project, `vxMailAgent`, incorporates third‑party open‑source software. Their licenses are compatible with GPL‑3.0, and the required attributions and notices are preserved here.

This file is provided for attribution convenience, and MUST be included when redistributing binaries or source, especially where dependencies licensed under Apache‑2.0 include a NOTICE requirement.

## How this file is maintained

- This is a curated list for prominent direct dependencies. For comprehensive, version‑accurate inventories, generate a release‑time report (see below) and attach it to distributions.
- Suggested release step (run in each package directory):
  - Backend: `npx license-checker --production --json > THIRD_PARTY_LICENSES.backend.json`
  - Frontend: `npx license-checker --production --json > THIRD_PARTY_LICENSES.frontend.json`

## Direct Dependencies (high‑level)

### Backend (`src/backend/package.json`)

- express — MIT
- cors — MIT
- dotenv — BSD-2-Clause
- @azure/msal-node — MIT
- googleapis — Apache-2.0
- openai — Apache-2.0

### Frontend (`src/frontend/package.json`)

- react, react-dom — MIT
- @mui/material, @mui/icons-material — MIT
- @emotion/react, @emotion/styled — MIT
- react-router-dom — MIT
- i18next, react-i18next — MIT
- vite, @vitejs/plugin-react — MIT
- tailwindcss — MIT
- react-markdown, remark-gfm — MIT
- framer-motion — MIT

## Apache‑2.0 NOTICE Preservation

Certain dependencies are licensed under Apache‑2.0, which requires preservation of any NOTICE text provided by those dependencies in distributions.

- googleapis (Apache‑2.0): https://github.com/googleapis/google-api-nodejs-client
- openai (Apache‑2.0): https://github.com/openai/openai-node

If these packages (or transitive Apache‑2.0 packages) include NOTICE files, keep those notices accessible in your distribution (e.g., by including this file and generated inventories).

## Additional Notes

- This project is licensed GPL‑3.0‑or‑later. Third‑party components remain under their respective licenses. Redistribution must include this file, the root LICENSE, and any generated third‑party license inventories.
