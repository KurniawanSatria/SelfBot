---
name: skill-creator
description: Panduan membuat, mengubah, atau memperbaiki skill baru untuk Clara. Pakai setiap kali pengguna bilang "buat skill", "bikin skill baru", "ajarin Clara cara ...", "ubah skill", atau minta dokumentasi langkah kerja yang harus diingat Clara. Skill disimpan sebagai file markdown di folder skills/ dan dibaca lewat tool read_skill.
---

# Skill Creator

Skill itu file markdown di folder `skills/`. Satu file = satu skill. Nama file = nama skill tanpa `.md`. Isinya dimuat hanya saat Clara memanggil `read_skill`.

## Kapan dipakai

Pakai skill ini saat pengguna:

- minta dibuatkan skill baru
- minta skill lama diubah atau diperbaiki
- menyuruh "ingat cara kerja X" dan langkahnya terlalu panjang untuk memory fakta

Kalau cuma satu fakta pendek, pakai tool `remember`. Kalau butuh langkah kerja berulang, buat skill.

## Alur membuat skill

### 1. Tentukan maksud

Tanyakan dulu, tapi tanyakan sesingkat mungkin dan hanya yang belum jelas:

- Skill ini bikin Clara bisa apa?
- Kapan skill ini harus dipakai?
- Bentuk hasilnya seperti apa?

Jangan wawancara panjang kalau pengguna sudah menjelaskan maksudnya. Kalau informasi sudah cukup, langsung tulis draf.

### 2. Verifikasi skill belum ada

Panggil `read_skill` memakai nama yang dituju. Kalau isinya balik, skill sudah ada dan yang perlu dilakukan adalah mengubah, bukan membuat baru.

### 3. Tulis draf

Panggil tool `save_skill` dengan nama dan isi markdown lengkap. Tool yang sama dipakai untuk mengubah skill yang sudah ada. Jangan mengarang hasil bahwa file sudah tersimpan sebelum tool mengembalikan konfirmasi.

Format file wajib:

```markdown
---
name: nama-skill
description: Kapan skill ini dipakai dan apa yang dikerjakan. Sebutkan kata-kata pemicu yang realistis.
---

# Judul

Penjelasan singkat.

## Kapan dipakai

...

## Langkah

1. ...

## Batasan

...
```

Aturan yang membuat skill ini tetap berguna:

- `name` huruf kecil, angka, dan tanda hubung saja. Maksimal 64 karakter.
- `description` maksimal 1024 karakter, tanpa tanda `<` atau `>`. Deskripsi ini satu-satunya pemicu, jadi sebutkan konteks pemakaian, bukan cuma isi skill.
- Tulis badan skill dengan kalimat perintah, bukan cerita.
- Jelaskan alasan sebuah langkah, bukan cuma menyuruh. Model lebih patuh kalau tahu kenapa.
- Jaga panjangnya. Di atas 500 baris, pecah ke beberapa skill.
- Jangan menyuruh sesuatu yang berbahaya atau membocorkan data pengguna.

### 4. Uji

Setelah skill tersimpan, uji dengan satu atau dua perintah nyata yang seharusnya memicu skill itu. Jalankan alurnya, lalu laporkan apa yang berhasil dan apa yang meleset.

Kalau hasilnya meleset, perbaiki `description` atau langkahnya, lalu uji lagi. Jangan mengubah banyak hal sekaligus karena penyebabnya jadi tidak jelas.

### 5. Laporkan

Sebutkan:

- nama file skill
- ringkas apa yang diubah
- hasil uji

## Mengubah skill yang sudah ada

Baca dulu versi sekarang lewat `read_skill`. Pertahankan nama dan file yang sama. Ubah bagian yang bermasalah saja, jangan menulis ulang seluruh file tanpa alasan.

## Contoh

Skill jelek karena deskripsinya tidak menyebut pemicu:

```markdown
description: Bantuan laporan.
```

Skill yang lebih baik:

```markdown
description: Membuat laporan penjualan bulanan dari file CSV penjualan. Pakai setiap kali pengguna menyebut rekap penjualan, laporan bulanan, omzet, atau minta data penjualan diolah.
```
