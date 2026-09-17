# secrets/

Kunci privat. **Seluruh isi direktori ini diabaikan git** (lihat `.gitignore`).

Taruh berkas service account Firebase di sini dengan nama:

```
firebase-service-account.json
```

Unduh dari Firebase Console -> Project Settings -> Service accounts ->
*Generate new private key*.

Setelah menaruhnya, kunci izinnya:

```bash
chmod 600 secrets/firebase-service-account.json
```

Jangan pernah menempelkan isi berkas ini ke chat, issue, atau log. Kalau
terlanjur, cabut kuncinya di Firebase Console (Service accounts -> kunci yang
bersangkutan -> hapus) dan buat yang baru.
