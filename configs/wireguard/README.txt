=== WIREGUARD CONFIGURATION ===

Server public key can be found in:
  configs/wireguard/server_public.key

Client configs can be downloaded from the dashboard.

To manually add a client:
  wg set wg0 peer <client_pubkey> allowed-ips <client_ip>/32
