import { logger } from './services/logger';
import { PORT, warnIfInsecure } from './config';
import { createServer } from './server';

logger.debug('=== Entering backend main entrypoint ===');
warnIfInsecure();
const app = createServer();
app.listen(PORT, '0.0.0.0', () => {
  logger.info('Backend listening', { url: `http://0.0.0.0:${PORT}`, port: PORT });
});
