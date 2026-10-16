import { isIP } from "node:net";

export function isPrivateIPv4(address) {
  return isIP(address) === 4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
}

export function localHttpsAddresses(interfaces, explicit) {
  if (explicit && !isPrivateIPv4(explicit)) throw new Error("Supply a private Wi-Fi IPv4 address, e.g. 192.168.0.218");
  const addresses = explicit ? [explicit] : Object.entries(interfaces)
    .sort(([a], [b]) => Number(!/^(en0|wi-fi|wlan|wl|eth)/i.test(a)) - Number(!/^(en0|wi-fi|wlan|wl|eth)/i.test(b)))
    .flatMap(([, items]) =>
    (items || []).filter((item) => !item.internal && isPrivateIPv4(item.address)).map((item) => item.address));
  // One IP certificate is also used for TLS clients that omit SNI. Use
  // localhost for loopback, or explicitly select another LAN interface.
  return ["localhost", addresses[0] || "127.0.0.1"];
}
