# vxMailAgent Backend

This is the Node.js/TypeScript backend for the vxMailAgent application. It provides:
- Express.js server for API endpoints
- OAuth endpoints for Gmail and Outlook
- Encrypted JSON persistence for all configuration and runtime data
- Health check endpoint at `/api/health`

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Set the encryption key as a 64-character hex string in the environment:
   ```bash
   export VX_MAILAGENT_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
   ```
3. Run in development mode:
   ```bash
   npm run dev
   ```

## Security
- The encryption key **must** be kept secret and never committed to source control.
- All persisted data is encrypted at rest.
- OAuth tokens and account data are never logged.

## TODO
- Implement full OAuth flows for Gmail/Outlook
- Implement account persistence endpoints
- Integrate with frontend
