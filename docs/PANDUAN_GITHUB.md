# Panduan Upload GitHub PUBLIC - ESORIA CodeFest

Skrip `upload.cmd` mengunggah **source code** ke GitHub. Proses ini **tidak** menjalankan deployment Firebase, tidak mengubah Firestore/Storage/Authentication, dan tidak merilis website produksi.

## Target utama

- Akun/repository: **`fikriianwarr/esoria-codefest`**
- URL: **https://github.com/fikriianwarr/esoria-codefest**
- Branch: **`main`**
- Visibilitas akhir: **PUBLIC**, sehingga semua orang bisa membuka kode di tab *Code* GitHub.
- Catatan: repo publik berarti isi kode dan materi yang di-commit dapat dibaca serta disalin orang lain. Itu tidak sama dengan membuka situs melalui GitHub Pages atau deployment Firebase.

## Cara upload sekali klik

1. Pasang **Git for Windows** dari https://git-scm.com/downloads/win dan **GitHub CLI** dari https://cli.github.com/ (jika sebelumnya sudah ada, tidak perlu memasang ulang).
2. Ekstrak ZIP seluruhnya, bukan menjalankan `upload.cmd` langsung dari penampil ZIP. Sebaiknya gunakan folder baru, misalnya `C:\Users\fikri\Downloads\ESORIA_CodeFest_GitHub_Public`.
3. Klik dua kali **`upload.cmd`** di folder utama ekstraksi.
4. Jika GitHub CLI belum login, selesaikan autentikasi melalui browser dengan akun yang memiliki akses membuat/mengubah repo tersebut.
5. Skrip memeriksa `origin`, status repo, riwayat commit, dan file yang akan diunggah; kemudian commit dan push **normal**, menjadikan branch `main` sebagai default bila diperlukan, mengatur visibilitas **public**, serta memverifikasinya.
6. Setelah muncul `BERHASIL`, buka https://github.com/fikriianwarr/esoria-codefest dan periksa bagian *Code*; jendela CMD menunggu Enter agar hasil dapat dibaca.

Skrip hanya bisa selesai jika internet, izin akun GitHub, Git, dan GitHub CLI berfungsi. Tidak ada jaminan bypass untuk penolakan akses, kebijakan protected branch, limit akun, atau kegagalan jaringan.

## Perbaikan pada versi ini

Masalah sebelumnya adalah pemanggilan `git remote get-url origin` ketika `origin` belum ada, yang pada **Windows PowerShell 5.1** dapat menjadi *terminating error* sebelum penanganan kondisi remote kosong. Versi baru memeriksa nama remote terlebih dahulu melalui `git remote`, lalu menjalankan `git remote add origin ...` hanya jika `origin` benar-benar belum ada.

Skenario yang didukung:

| Kondisi | Tindakan |
|---|---|
| Repo GitHub belum dibuat | Buat repository **public**, inisialisasi Git, commit, dan push `main` |
| Repo sudah dibuat dan kosong | Tambahkan `origin`, commit, lalu push |
| Repo sudah ada dan mempunyai README/commit, tetapi folder ZIP belum memiliki riwayat Git | Ambil riwayat resmi lewat `fetch`, hubungkan HEAD tanpa `--force`, pertahankan file remote yang tidak ada di ZIP, lalu commit perubahan source |
| Repo GitHub sudah **private** | Push terlebih dahulu, kemudian ubah menjadi **public** melalui `gh repo edit` dan verifikasi visibilitas |
| `.git` lokal dan `origin` benar sudah ada | Lakukan commit perubahan baru dan push normal ke `main`; `origin` SSH untuk repo yang sama dinormalisasi ke HTTPS |
| `origin` mengarah ke repo lain | Berhenti, tidak mengganti tujuan secara diam-diam |
| Remote berubah dan Git menolak push normal | Berhenti; tinjau divergensi sebelum melakukan sinkronisasi manual |

**Penting:** saat pertama kali menyatukan folder ZIP dengan repo yang sudah ada, file yang *hanya* ada di repo lama dipertahankan (tidak langsung dihapus). Periksa *Code* setelah upload dan hapus file usang secara terencana jika dibutuhkan. Perubahan status private ke public juga mengekspos **riwayat commit dan GitHub Actions/log sebelumnya**; pastikan tidak ada rahasia di riwayat repo lama.

## Proteksi data dan akses publik

- `.gitignore` mencegah pelacakan file `.env`, secret lokal, service account, cache, log, `node_modules`, file database lokal, serta arsip ekspor akar folder.
- ZIP tetap menyertakan file konfigurasi lokal `functions/.env.esoria-codefest` dan `functions/.env.demo-esoria-codefest` agar pengujian lokal tetap berfungsi. **Keduanya diabaikan Git dan tidak diunggah**; jangan pernah mengisi file-file tersebut dengan kredensial untuk dibagikan melalui ZIP. Gunakan `functions/.env.example` jika ingin membuat konfigurasi baru.
- Skrip mengaudit nama file terlacak dan sejumlah pola token/kunci privat berisiko tinggi. **Pemeriksaan ini bukan audit keamanan lengkap**: tinjau sendiri informasi pribadi, aset berhak cipta, bahan lomba, isi ZIP challenge, dan konfigurasi sebelum publikasi.
- Jangan menyimpan Personal Access Token, private key, password, backup database, data pendaftaran, atau bukti transfer dalam repo public.
- Konfigurasi Firebase Web API key di JavaScript frontend memang dapat terlihat publik; akses data tetap harus dilindungi Rules, App Check, autentikasi, dan izin backend yang benar.
- Publikasi kode tidak otomatis memberikan lisensi open-source untuk digunakan ulang. Lisensi harus diputuskan tersendiri.

## Pemeriksaan manual (opsional)

Buka CMD di folder proyek dan jalankan:

```bat
gh auth status
git remote -v
git branch --show-current
git status
gh repo view fikriianwarr/esoria-codefest --json visibility,defaultBranchRef
```

Untuk repo alternatif milik Anda, gunakan CMD:

```bat
set "ESORIA_GITHUB_REPO=akun-anda/nama-repo"
upload.cmd
```

Variabel ini hanya mengubah tujuan; **visibilitas tetap public**. Pastikan repo alternatif memang milik Anda atau Anda memiliki akses tulis yang sah.

## Troubleshooting

| Pesan error | Perbaikan aman |
|---|---|
| `No such remote 'origin'` | Bug versi lama. Ekstrak ZIP revisi ke folder baru dan jalankan `upload.cmd` yang baru |
| Git / `gh` tidak ditemukan | Instal Git for Windows / GitHub CLI dan buka ulang CMD |
| Login gagal / `401` / `403` | `gh auth login`, periksa akun GitHub aktif serta izin repository |
| `Repository not found` | Periksa URL, username, jaringan, dan hak membuat repository |
| `origin` berbeda | Periksa `git remote -v`. Skrip tidak mengganti remote lain tanpa pemeriksaan |
| `non-fast-forward` | Ada commit baru yang belum diintegrasikan; jangan force-push. Clone/fetch dan lakukan merge/rebase yang diperiksa |
| `protected branch` | Gunakan branch dan pull request sesuai aturan repo. Skrip tidak membypassnya |
| Repo masih private | Baca error perubahan visibilitas; cek hak admin; perintah resmi adalah `gh repo edit OWNER/REPO --visibility public --accept-visibility-change-consequences` |
| Upload sukses tetapi website Firebase belum berubah | Normal: upload source GitHub berbeda dari deployment Firebase |

Skrip bukan mekanisme backup/rollback produksi, tidak memanggil `DEPLOY_SEMUA.cmd`, tidak `firebase deploy`, dan tidak menggunakan force-push.
