import { config } from '../agent/config.mjs';
import { BrowserManager } from '../agent/browser.mjs';
const c = config(), profile = c.profiles[process.argv[2] || 'chatgpt:default'];
if (!profile) throw new Error('Profile tidak ditemukan di .local/config.json');
const browsers = new BrowserManager(c); await browsers.openProfile(profile); browsers.close();
console.log('Profile browser dibuka. Login manual; jangan salin cookies ke repo.');
