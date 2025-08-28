# vxMailAgent Frontend

This is the React/TypeScript frontend for the vxMailAgent application. It provides:
- UI for account management, director/agent configuration, filters, memory, and results
- OAuth flows for Gmail/Outlook
- Integration with backend API at `/api`
- Tailwind CSS and Material-UI for styling and components

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Run in development mode:
   ```bash
   npm run dev
   ```

## Structure
- `src/` — React components, hooks, and utilities
- `vite.config.ts` — Vite configuration (proxies `/api` to backend)

## Further Reading
- See `docs/DEVELOPER.md` for architecture and UI details.
