/**
 * Prints the addresses a phone on the same Wi-Fi can use to open the dev server and the in-memory Door43.
 * Run `npm run lan`, then open the first address on the phone (same network).
 */
import os from "node:os";

const port = Number(process.env.VITE_PORT || 5177);
const mockPort = Number(process.env.MOCK_PORT || 8787);
const addresses = [];
// A VPN or a virtual adapter is not the network the phone is on.
const NOT_LAN = /vpn|wireguard|tun|tap|vethernet|virtualbox|vmware|hyper-v|loopback|bluetooth/i;
for (const [name, list] of Object.entries(os.networkInterfaces())) {
  if (NOT_LAN.test(name)) continue;
  for (const i of list ?? []) {
    if (i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254.")) addresses.push({ name, address: i.address });
  }
}

if (!addresses.length) {
  console.log("No se encontró una red local. Conecta el computador a la misma red Wi-Fi que el teléfono.");
  process.exit(1);
}
for (const { name, address } of addresses) {
  console.log(`\n${name}`);
  console.log(`  App en el teléfono:   http://${address}:${port}/`);
  console.log(`  Como Ana, Bea, Carla: http://${address}:${port}/?mockUser=ana  (o bea, carla)   [solo con el Door43 de mentira]`);
  console.log(`  Door43 de mentira:    http://${address}:${mockPort}/`);
}
console.log("\nEl teléfono y el computador deben estar en la misma red, y el firewall debe dejar entrar a Node en redes privadas.");
