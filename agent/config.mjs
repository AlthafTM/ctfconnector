import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
export const localDir = resolve(process.env.CTFCONNECTOR_DATA || '.local');
export function credential() {
  if (process.env.CTF_GITHUB_TOKEN) return process.env.CTF_GITHUB_TOKEN;
  const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const token = out.split(/\r?\n/).find(l => l.startsWith('password='))?.slice(9);
  if (!token) throw new Error('Atur CTF_GITHUB_TOKEN atau login Git Credential Manager.');
  return token;
}
export function protect(value) {
  if (process.platform !== 'win32') throw new Error('Non-Windows: gunakan CTF_PAIRING_KEY environment variable.');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[void][Reflection.Assembly]::LoadWithPartialName("System.Security"); $b=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'], { input: value, encoding: 'utf8', windowsHide: true }).trim();
}
export function unprotect(value) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[void][Reflection.Assembly]::LoadWithPartialName("System.Security"); $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'], { input: value, encoding: 'utf8', windowsHide: true }).trim();
}
export function config() {
  const c = JSON.parse(readFileSync(resolve(localDir, 'config.json'), 'utf8'));
  return { ...c, token: credential(), secret: process.env.CTF_PAIRING_KEY || unprotect(c.protectedKey) };
}
export function saveConfig(c) { mkdirSync(localDir, { recursive: true }); writeFileSync(resolve(localDir, 'config.json'), JSON.stringify(c, null, 2), { mode: 0o600 }); }
