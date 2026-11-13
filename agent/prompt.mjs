export function inferCategory(description, files = []) {
  const text = `${description} ${files.map(f => f.name).join(' ')}`.toLowerCase();
  const checks = [
    ['pwn', /buffer overflow|ret2libc|format string|heap exploit|checksec|rop chain/],
    ['crypto', /\brsa\b|\baes\b|elliptic|ciphertext|nonce|modulus|cryptograph/],
    ['forensics', /\.pcap(?:ng)?\b|memory dump|disk image|volatility|wireshark|forensic/],
    ['stego', /steganograph|stegano|\blsb\b|steghide|zsteg/],
    ['web', /https?:\/\/|\bsqli\b|\bxss\b|\bssti\b|web app|web challenge|\bjwt\b/],
    ['osint', /\bosint\b|geolocat|reverse image|find (the )?location/],
    ['rev', /reverse engineer|decompil|\.exe\b|\.wasm\b|\.apk\b|validator|ghidra/]
  ];
  return checks.find(([, pattern]) => pattern.test(text))?.[0] || 'misc';
}
export function generatePrompt(t) {
  const category = ['pwn','rev','web','crypto','forensics','stego','osint','misc'].includes(t.category) ? t.category : 'misc';
  return `ini soal dari event/kompetisi CTF, bagian ${category}.

the question is:
${t.description}${t.flagFormat ? `

the flag format is ${t.flagFormat}` : ''}${t.scope ? `

scope: ${t.scope}` : ''}

kalau perlu jalanin command di PC, kirim command-nya aja. solver kalau memang dibutuhkan.`;
}
