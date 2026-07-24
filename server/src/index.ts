import "dotenv/config";
import { createApp } from "./app.js";
import { createPool } from "./db.js";

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
const pool = createPool();
const app = createApp(pool);

app.listen(port, () => {
  console.log(`FlowCue AI backend listening on http://localhost:${port}`);
});
