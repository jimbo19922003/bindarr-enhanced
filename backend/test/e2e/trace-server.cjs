'use strict';
const childProcess = require('node:child_process');
const originalSpawn = childProcess.spawn;
const servers = [];
const limit = 32768;
childProcess.spawn = function (...parameters) {
  const child = Reflect.apply(originalSpawn, this, parameters);
  const args = parameters[1];
  if (Array.isArray(args) && args.some(arg => /[\\/]src[\\/]server\.js$/.test(String(arg)))) {
    const record = {pid: child.pid, stdout: '', stderr: ''};
    servers.push(record);
    for (const stream of ['stdout', 'stderr']) {
      child[stream]?.on('data', chunk => { record[stream] = (record[stream] + chunk.toString()).slice(-limit); });
    }
  }
  return child;
};
process.once('exit', code => {
  if (code === 0 || !servers.length) return;
  const last = servers[servers.length - 1];
  process.stderr.write(`\n=== Failed suite: last spawned test server ${last.pid} (bounded output tails) ===\n`);
  process.stderr.write(`STDOUT:\n${last.stdout}\nSTDERR:\n${last.stderr}\n`);
});
