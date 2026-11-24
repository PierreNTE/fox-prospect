-- v32 — Téléphone de l'expéditeur (corps et signature des emails).
alter table settings add column if not exists sender_phone text;
