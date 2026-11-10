# Panduan Full Deploy ESORIA CodeFest

Ekstrak ZIP lalu klik `DEPLOY_SEMUA.cmd`. Semua tahap berjalan tanpa prompt Y/N dan melakukan tes wajib sebelum perubahan produksi.

Target: `esoria-codefest`. Membutuhkan Windows PowerShell 5.1, koneksi internet, Java JDK 17+ untuk Firebase Emulator, serta Google Cloud CLI dengan izin Firebase dan ADC. Node.js 22 dipakai secara portable jika belum tersedia.

Yang dideploy: Firestore indeks/Rules, Storage Rules, enam Cloud Functions, Hosting. Penyimpanan Auth, Firestore dan Storage **tidak dikosongkan** dan tidak diisi dataset tambahan oleh launcher ini.

Jika akses gcloud/Firebase memerlukan autentikasi ulang, browser mungkin terbuka. Jika perubahan indeks atau fungsi lama membutuhkan penghapusan, CLI non-interaktif akan menghentikan deploy. Tidak ada `--force` ataupun langkah penghapusan otomatis. Pengujian harus lulus; tidak ada backup otomatis, dan rollback manual mungkin diperlukan.

Hasil deploy dan error terlihat langsung pada CMD (jendela tetap terbuka jika gagal). Tidak ada file log permanen secara default. Untuk diagnosis khusus, set `ESORIA_SAVE_DEPLOY_LOG=1` agar `deploy-last.log` dibuat secara lokal. Periksa juga Firebase Console serta aplikasi live setelah deploy untuk verifikasi manual login, App Check, pembayaran, sertifikat, dan notifikasi.

Setelah proses selesai atau berhenti karena kesalahan, jendela CMD tetap terbuka. **Tekan Enter untuk menutupnya**.
