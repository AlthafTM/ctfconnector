import { config } from '../agent/config.mjs';
const c = config();
console.log(`Dashboard: https://althaftm.github.io/ctfconnector/\nRelay: ${c.repo}\nPairing key (rahasia; masukkan hanya di dashboard): ${c.secret}\nBuat fine-grained GitHub token khusus repo relay, Contents: read/write. Jangan pakai token global di HP.`);
