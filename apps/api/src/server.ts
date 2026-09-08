import { createApp, logger } from './app.js';
import { readConfig } from './config.js';
import { Database } from './db.js';

const config = readConfig();
const database = new Database(config.MONGO_URL);
await database.connect();
await database.ready();
const server = createApp(database, config).listen(config.PORT, '0.0.0.0', () => {
  logger.info({ port: config.PORT }, 'AlphaSutra paper API ready');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => {
      void database.close();
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
