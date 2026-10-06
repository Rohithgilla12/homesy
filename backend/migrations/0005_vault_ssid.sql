-- 0005_vault_ssid.sql
-- The real network name for Wi-Fi entries, so the QR code joins the right network (expand-only).

alter table vault_entries add column ssid text;
