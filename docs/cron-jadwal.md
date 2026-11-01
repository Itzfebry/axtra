# Cron per menit untuk Jadwal

Vercel Hobby hanya mendukung cron 1×/hari. Supaya pengingat dan timer terkirim
tepat waktu (presisi menit), layanan cron eksternal harus memanggil endpoint
dispatch tiap menit:

```
GET https://axtra2.vercel.app/api/cron/minutely
Authorization: Bearer <CRON_SECRET>
```

`CRON_SECRET` tersimpan sebagai environment variable Vercel (Production dan
Preview). Nilainya tidak ditulis di repo.

Respons contoh:

```json
{
  "ok": true,
  "schedules_fired": 1,
  "push_sent": 0,
  "push_failed": 0,
  "outbox_sent": 1,
  "outbox_failed": 0,
  "detail": ""
}
```

Endpoint ini idempoten: satu baris jadwal hanya diklaim sekali walau dua cron
memanggil bersamaan. Selama tidak ada yang memanggilnya, jadwal berstatus
`active` tidak akan dikirim.

## Opsi A — cron-job.org (rekomendasi, interval 1 menit)

1. Daftar/masuk ke https://cron-job.org.
2. **Create cronjob**.
3. Title: `Axtra jadwal`.
4. URL: `https://axtra2.vercel.app/api/cron/minutely`.
5. Schedule: **Every 1 minute**.
6. Tab **Advanced** → **Request method**: `GET`.
7. Tab **Headers** → tambah:
   - Key: `Authorization`
   - Value: `Bearer <CRON_SECRET>`
8. Simpan dan **Enable**.

## Opsi B — GitHub Actions (minimal 5 menit)

Buat `.github/workflows/jadwal-cron.yml`:

```yaml
name: Axtra jadwal cron
on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch: {}
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch minutely
        run: |
          curl -fsS -X GET "https://axtra2.vercel.app/api/cron/minutely" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

Tambahkan `CRON_SECRET` di **Settings → Secrets and variables → Actions**.
Catatan: penjadwalan GitHub tidak presisi dan minimum 5 menit.

## Opsi C — Uptime monitor

Layanan seperti UptimeRobot dapat memantau URL tiap menit, tetapi jadwalnya
bisa bergeser dan sebaiknya tetap memakai header `Authorization`. Gunakan
cron-job.org bila butuh presisi menit.

## Verifikasi manual

```bash
curl -i "https://axtra2.vercel.app/api/cron/minutely" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Tanpa header yang benar endpoint membalas `401`; bila `CRON_SECRET` belum
di-set, `503`.