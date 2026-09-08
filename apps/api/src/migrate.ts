import { Database, migrate } from './db.js';
import { readConfig } from './config.js';

const database = new Database(readConfig().MONGO_URL);
try {
  await database.connect();
  await migrate(database);
  await database.ready();
} finally {
  await database.close();
}
