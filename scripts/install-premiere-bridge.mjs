// QA development installer. Does not change Adobe or Windows security settings.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const adobeRoot = process.platform === 'win32' ? process.env.APPDATA : path.join(os.homedir(), 'Library', 'Application Support');
if (!adobeRoot) throw new Error('Missing user application-data directory');
const destination = path.join(adobeRoot, 'Adobe', 'CEP', 'extensions', 'com.quickcaption.premiere.bridge.qa');
const pluginConfiguration = path.join(workspace, 'premiere-plugin', 'bridge-config.json');
let configuration;
try { configuration = JSON.parse(await readFile(pluginConfiguration, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (configuration && (!/^[a-f0-9]{64}$/.test(configuration.token) || configuration.port !== 37289)) throw new Error('Invalid existing bridge configuration; refusing to replace the pairing key');
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ destination, pluginConfiguration, port: 37289, changesSecuritySettings: false }, null, 2));
} else {
  configuration ||= { port: 37289, token: randomBytes(32).toString('hex') };
  await mkdir(destination, { recursive: true });
  await cp(path.join(workspace, 'premiere-bridge'), destination, { recursive: true, filter: source => path.basename(source) !== 'bridge-config.json' });
  await writeFile(path.join(destination, 'bridge-config.json'), JSON.stringify(configuration), { mode: 0o600 });
  await writeFile(pluginConfiguration, JSON.stringify(configuration), { mode: 0o600 });
  console.log(`QA bridge copied to ${destination}. Restart Premiere after enabling CEP development mode manually. Pairing key was preserved and was not printed.`);
}
