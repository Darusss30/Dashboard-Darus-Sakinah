# Dashboard Kinerja Karyawan

Dashboard ini dibuat sebagai static site murni agar mudah di-host di Netlify, Vercel, GitHub Pages, Cloudflare Pages, atau hosting biasa.

## File

- `index.html`: halaman utama dashboard
- `config.js`: konfigurasi endpoint live
- `styles.css`: styling dashboard
- `app.js`: logika render, filter, dan adapter data
- `dashboard-data.json`: contoh data lokal

## Sumber data

Dashboard ini mendukung 3 sumber data:

1. `window.__DARUS_DASHBOARD_DATA__`
2. `window.DARUS_DASHBOARD_CONFIG.apiUrl`
3. `window.DARUS_DASHBOARD_CONFIG.employeeApiUrl` + `scoreApiUrl` + `attendanceApiUrl`
4. `dashboard-data.json`

Urutan di atas dipakai otomatis oleh `app.js`.

## Integrasi n8n

Jika Anda ingin data live dari n8n:

1. Import workflow [DS Dashboard API.json](/a:/DARUS/DS%20Dashboard%20API.json) ke n8n.
2. Pastikan credential Google Sheets yang dipakai sama dengan workflow HR Anda saat ini.
3. Aktifkan workflow.
4. Salin 2 production webhook URL:
   - `.../webhook/darus-dashboard-employee-master`
   - `.../webhook/darus-dashboard-final-score-bulanan`
   - `.../webhook/darus-dashboard-attendance`
5. Isi [config.js](/a:/DARUS/dashboard-kinerja/config.js) seperti ini:

```js
window.DARUS_DASHBOARD_CONFIG = {
  apiUrl: "",
  employeeApiUrl: "https://N8N-ANDA/webhook/darus-dashboard-employee-master",
  scoreApiUrl: "https://N8N-ANDA/webhook/darus-dashboard-final-score-bulanan",
  attendanceApiUrl: "https://N8N-ANDA/webhook/darus-dashboard-attendance",
};
```

6. Upload folder `dashboard-kinerja` ke hosting Anda.

Jika nanti Anda ingin 1 endpoint gabungan, dashboard ini juga sudah mendukung `apiUrl`, tetapi workflow yang saya siapkan sekarang memakai 2 endpoint agar sederhana dan stabil.

## Catatan hosting

- Workflow `DS Dashboard API` yang saya buat sudah mengisi `Allowed Origins (CORS)` ke `*`.
- Jika Anda memakai `dashboard-data.json`, file itu harus ikut di-upload bersama file lain.
- Untuk preview lokal, cukup jalankan server statis sederhana, misalnya `python -m http.server`.
