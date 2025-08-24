console.log('[DEBUG] === Entering backend main entrypoint ===');
import { PORT, warnIfInsecure } from './config';
import { createServer } from './server';

warnIfInsecure();
const app = createServer();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend listening on http://0.0.0.0:${PORT}`);
});
