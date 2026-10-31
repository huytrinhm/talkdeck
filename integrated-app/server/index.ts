import { serve } from "@hono/node-server";
import { createProductApp } from "./app.js";
const host = createProductApp({
  directory: process.env.TALKDECK_DATA_DIRECTORY,
});
const server = serve(
  {
    fetch: host.app.fetch,
    hostname: "127.0.0.1",
    port: Number(process.env.TALKDECK_API_PORT ?? 3001),
  },
  (info) =>
    console.log(`Talkdeck API listening at http://127.0.0.1:${info.port}`),
);
async function close() {
  server.close();
  await host.close();
  process.exit(0);
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
