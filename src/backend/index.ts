import { logger } from './services/logger';
import { PORT, warnIfInsecure } from './config';
import { createServer } from './server';
import { bootstrapFetchers } from './services/fetcher-bootstrap';

logger.debug('=== Entering backend main entrypoint ===');
warnIfInsecure();
const { app, fetcherManager } = createServer();
app.listen(PORT, '0.0.0.0', () => {
  logger.info('Backend listening', { url: `http://0.0.0.0:${PORT}`, port: PORT });
  // Start background bootstrap of per-user fetchers after the server is ready
  void bootstrapFetchers(fetcherManager);
});
