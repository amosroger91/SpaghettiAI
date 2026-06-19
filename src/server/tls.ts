import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import selfsigned from "selfsigned";
import { DATA_DIR } from "../config.js";

const CERT_DIR = join(DATA_DIR, "certs");
const KEY_FILE = join(CERT_DIR, "phone-key.pem");
const CERT_FILE = join(CERT_DIR, "phone-cert.pem");

export interface TlsMaterial {
  key: string;
  cert: string;
}

/** All non-internal IPv4 addresses of this host (the addresses a phone can reach). */
export function lanIPv4(): string[] {
  const out: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out;
}

/**
 * Return a self-signed key/cert pair for the phone HTTPS server, generating and
 * caching one on first run. The cert lists the host's LAN IPs as SANs so the phone
 * page loads at https://<lan-ip>:<port> — the browser still shows a one-time
 * "not trusted" warning (expected for self-signed), which the user accepts once.
 */
export async function ensureCert(): Promise<TlsMaterial> {
  if (existsSync(KEY_FILE) && existsSync(CERT_FILE)) {
    return { key: readFileSync(KEY_FILE, "utf8"), cert: readFileSync(CERT_FILE, "utf8") };
  }
  const altNames = [
    { type: 2 as const, value: "localhost" }, // DNS
    { type: 7 as const, ip: "127.0.0.1" }, // IP
    ...lanIPv4().map((ip) => ({ type: 7 as const, ip })),
  ];
  const pems = await selfsigned.generate([{ name: "commonName", value: "spaghetti-ai-phone" }], {
    notAfterDate: new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000), // ~10 years
    keySize: 2048,
    algorithm: "sha256",
    extensions: [{ name: "subjectAltName", altNames }],
  });
  mkdirSync(CERT_DIR, { recursive: true });
  writeFileSync(KEY_FILE, pems.private);
  writeFileSync(CERT_FILE, pems.cert);
  return { key: pems.private, cert: pems.cert };
}
