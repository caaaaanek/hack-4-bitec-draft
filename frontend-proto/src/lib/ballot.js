/* «Анонімність, яку можна перевірити»: жетон зі сліпим підписом RSA (backend/app/services/ballots.py).
 * 1) GET ballot-key → (n, e); 2) nonce, m = FDH-SHA512(домен ‖ лічильник ‖ nonce) mod n, засліплення m·rᵉ mod n;
 * 3) POST ballot → s' (тут сервер записує участь); 4) s = s'·r⁻¹ mod n; 5) POST /respond/ballot без входу;
 * 6) квитанція sha256(домен ‖ nonce): після закриття хвилі GET /respond/receipts/{квитанція}.
 * Лише WebCrypto і BigInt, без бібліотек. */
const DOMAIN = new TextEncoder().encode("integra-ballot-v1");
const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
export const toHex = b => [...b].map(x => x.toString(16).padStart(2, "0")).join("");
const fromHex = h => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));
const bytesToBig = b => b.length ? BigInt("0x" + toHex(b)) : 0n;
export const big = h => BigInt("0x" + h);
export const hex = n => n.toString(16);
export function modPow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
export function modInv(a, m) { let [o, r] = [a % m, m], [s0, s1] = [1n, 0n]; while (r) { const q = o / r; [o, r] = [r, o - q * r]; [s0, s1] = [s1, s0 - q * s1]; } if (o !== 1n) throw new Error("not invertible"); return (s0 % m + m) % m; }
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const byteLen = n => Math.ceil(n.toString(2).length / 8);
const rnd = k => crypto.getRandomValues(new Uint8Array(k));

export async function messageInt(nonce, n) {
  const size = byteLen(n); let out = new Uint8Array(0), c = 0;
  while (out.length < size) { const ctr = new Uint8Array(4); new DataView(ctr.buffer).setUint32(0, c++); out = cat(out, new Uint8Array(await crypto.subtle.digest("SHA-512", cat(DOMAIN, ctr, nonce)))); }
  return bytesToBig(out.slice(0, size)) % n;
}
export const receiptOf = async nonce => toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", cat(DOMAIN, nonce))));
// Засліплення: повертає { nonce, blinded, r }
export async function blind(nHex, e) {
  const n = big(nHex), nonce = rnd(32), m = await messageInt(nonce, n);
  let r; do { r = bytesToBig(rnd(byteLen(n) + 8)) % n; } while (r < 2n || gcd(r, n) !== 1n);
  return { nonce: toHex(nonce), blinded: hex(m * modPow(r, BigInt(e), n) % n), r: hex(r) };
}
export const unblind = (nHex, sigHex, rHex) => { const n = big(nHex); return hex(big(sigHex) * modInv(big(rHex), n) % n); };
// Перевірка в браузері до надсилання: sᵉ = m (інакше сервер підписав не те, що ми засліпили)
export async function verifySig(nHex, e, nonceHex, sHex) { const n = big(nHex); return modPow(big(sHex), BigInt(e), n) === await messageInt(fromHex(nonceHex), n); }
export const nonceBytes = fromHex;
