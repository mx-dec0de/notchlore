import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./packet.py', import.meta.url));
const python = process.platform === 'win32' ? 'python' : 'python3';

/** Run the standard-library transport helper without a shell or imported code. */
export async function runPacket(args) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
    throw new TypeError('Packet arguments must be an array of strings.');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(python, [helper, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let output = '';
    let diagnostic = '';
    let overflow = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 60_000);
    timeout.unref();
    child.stdout.on('data', chunk => {
      output += chunk;
      if (Buffer.byteLength(output) > 8 * 1024 * 1024) {
        overflow = true;
        child.kill();
      }
    });
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-4096); });
    child.on('error', error => {
      clearTimeout(timeout);
      reject(new Error(error.code === 'ENOENT'
        ? 'Packet commands require Python 3 on PATH. Install Python 3, then retry; other commands do not need it.'
        : `Cannot start packet helper: ${error.message}`));
    });
    child.on('close', code => {
      clearTimeout(timeout);
      if (timedOut) return reject(new Error('Packet helper exceeded 60 seconds and was stopped. Inspect any output destination before retrying.'));
      if (overflow) return reject(new Error('Packet helper output exceeded its safety limit.'));
      let result;
      try { result = JSON.parse(output); }
      catch { return reject(new Error(`Packet helper did not return JSON: ${diagnostic || `exit ${code}`}`)); }
      if (code !== 0 || !result.ok) {
        const error = new Error(result.error || `Packet command failed with exit ${code}.`);
        error.result = result;
        return reject(error);
      }
      resolve(result);
    });
  });
}
