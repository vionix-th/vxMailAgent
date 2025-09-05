import { logger } from './services/logger';
import { PORT, HOST, warnIfInsecure } from './config';
import { createServer } from './server';
import { bootstrapFetchers } from './services/fetcher-bootstrap';

logger.debug('=== Entering backend main entrypoint ===');
warnIfInsecure();
const { app, fetcherManager } = createServer();
app.listen(PORT, HOST, () => {
  logger.info('Backend listening', { url: `http://${HOST}:${PORT}`, port: PORT, host: HOST });
  // Start background bootstrap of per-user fetchers after the server is ready
  void bootstrapFetchers(fetcherManager);
});
