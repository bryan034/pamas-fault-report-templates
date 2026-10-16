type IdCrypto = Pick<Crypto, "getRandomValues"> &
  Partial<Pick<Crypto, "randomUUID">>;

/** UUID v4 for editor IDs on HTTPS/localhost and plain-HTTP LAN previews. */
export function createId(cryptoApi: IdCrypto | undefined = globalThis.crypto): string {
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  // getRandomValues is also available in insecure contexts. Do not replace it
  // with Math.random: keep the same random UUID format/quality in both paths.
  if (typeof cryptoApi?.getRandomValues !== "function")
    throw new Error("This browser cannot generate secure IDs. Use a current browser or HTTPS.");

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // UUID version 4.
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC UUID variant, leading bits 10.
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
