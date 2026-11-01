import { startServer } from './server.mjs';

const args = process.argv.slice(2);
const options = { port: 5678, host: '127.0.0.1', transport: 'stdio' };
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--port') options.port = Number(args[++i]);
  else if (arg === '--http') options.transport = 'http';
  else if (arg === '--readonly') options.readonly = true;
  else throw new Error(`Unknown argument: ${arg}`);
}
if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
  throw new Error('--port must be between 1 and 65535');
}
if (process.env.AUTOMATION_SCRIPT_MCP_TOKEN) options.token = process.env.AUTOMATION_SCRIPT_MCP_TOKEN;
const service = await startServer(options);
console.error(`Authorize the extension using this private URL:\n${service.connectUrl}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await service.close();
  process.exit(0);
});
