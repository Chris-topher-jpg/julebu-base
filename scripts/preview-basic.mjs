import { fileURLToPath } from 'node:url';
import { createBasicClubServer } from '../editions/basic/server.mjs';

// Keep the archived sources intact and reuse the original basic-edition data.
const port = Number(process.env.BASIC_PORT || 4176);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('BASIC_PORT 必须为 1–65535 的整数');
}
const { server, close } = createBasicClubServer({
  database: process.env.BASIC_CLUB_DATABASE || fileURLToPath(new URL('../data/club-basic.sqlite', import.meta.url)),
  production: process.env.NODE_ENV === 'production',
  publicOrigin: process.env.CLUB_PUBLIC_ORIGIN,
  adminUsername: process.env.CLUB_ADMIN_USERNAME,
  adminPassword: process.env.CLUB_ADMIN_PASSWORD,
  adminName: process.env.CLUB_ADMIN_NAME,
  paymentContact: process.env.CLUB_PAYMENT_CONTACT,
});
let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  server.close(() => close());
  server.closeAllConnections();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
server.once('error', error => {
  console.error('基础版启动失败', error.message);
  process.exitCode = 1;
  shutdown();
});
server.listen(port, '127.0.0.1', () => console.log(`已保留的基础版 http://127.0.0.1:${port}/`));
