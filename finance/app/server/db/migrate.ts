import { openDatabase } from "./client.ts";
import { ensureCatalog } from "./seed.ts";

const opened = openDatabase();
ensureCatalog(opened.db);
console.log(`ok ${opened.dbFile}`);
opened.sqlite.close();
