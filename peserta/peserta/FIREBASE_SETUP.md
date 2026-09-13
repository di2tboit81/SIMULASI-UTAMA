# SETUP FIREBASE — LOGIN USERNAME + PASSWORD

## Yang digunakan
- Firebase Authentication — Email/Password (dipakai sebagai mesin autentikasi internal)
- Cloud Firestore — menyimpan indeks username dan nama peserta

## Yang tidak digunakan
- Google Login (boleh dinonaktifkan)
- Realtime Database
- Storage

## Alur peserta
DAFTAR → Nama Lengkap + Username + Password → konfirmasi berhasil → LOGIN → HALAMAN UTAMA

LOGIN → Username + Password → HALAMAN UTAMA

Peserta tidak perlu memasukkan email. Aplikasi membuat email internal berdasarkan username untuk memenuhi format Firebase Authentication; email internal itu tidak ditampilkan kepada peserta.

## WAJIB: buat Cloud Firestore
Karena username harus bisa dicari saat login, buka Firebase Console → Firestore Database → Create database.
Pilih lokasi database yang sesuai dan mudah dijangkau pengguna aplikasi. Untuk pengujian awal, gunakan mode yang memungkinkan pembuatan data oleh pengguna yang sudah login, lalu pasang Rules di bawah.

## Firestore Rules yang disarankan untuk aplikasi ini
Tempel aturan berikut di Firestore Database → Rules, lalu Publish:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /usernames/{username} {
      allow get: if true;
      allow list: if false;
      allow create: if request.auth != null
                    && request.resource.data.uid == request.auth.uid
                    && request.resource.data.username == username;
      allow update, delete: if request.auth != null
                            && resource.data.uid == request.auth.uid;
    }

    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Catatan: dokumen `usernames/{username}` dapat dibaca dengan exact username tanpa login karena aplikasi perlu mencari akun sebelum autentikasi. Dokumen hanya berisi uid, username, namaLengkap, dan alamat email internal yang dibuat aplikasi; jangan simpan password di Firestore.

## Konfigurasi
- `firebase-config.js` = konfigurasi Web App Firebase
- `firebase-auth.js` = alur DAFTAR/LOGIN username + password
- `index.html` = tampilan login/daftar dan aplikasi utama
- `app.js` = logika soal/simulasi yang sudah ada
- `DATABASE_SKD_IPDN_CPNS_2026.xlsx` = database soal lokal
