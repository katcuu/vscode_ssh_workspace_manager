'use strict';

const net = require('node:net');
const endpoint = process.env.SSH_WORKSPACE_MANAGER_ASKPASS_PIPE;
const prompt = process.argv.slice(2).join(' ');

if (!endpoint) process.exit(1);

const socket = net.createConnection(endpoint);
socket.setEncoding('utf8');
let buffer = '';
let sent = false;
const timer = setTimeout(() => socket.destroy(), 5 * 60 * 1000);
timer.unref();

socket.on('connect', () => socket.write(`${JSON.stringify({ prompt })}\n`));
socket.on('data', chunk => {
  buffer += chunk;
  const newline = buffer.indexOf('\n');
  if (newline < 0) return;
  sent = true;
  clearTimeout(timer);
  let response;
  try { response = JSON.parse(buffer.slice(0, newline)); } catch { socket.destroy(); return; }
  if (response.cancel === true || typeof response.value !== 'string') {
    socket.end(); process.exitCode = 1; return;
  }
  process.stdout.write(response.value);
  socket.end(); process.exitCode = 0;
});
socket.on('error', () => { clearTimeout(timer); process.exitCode = 1; });
socket.on('close', () => { clearTimeout(timer); if (!sent) process.exitCode = 1; });
