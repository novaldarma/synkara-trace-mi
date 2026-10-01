# GATE 8 FINAL REPORT — SYNKARA / TRACE-MI, CALIBER 2026 Case 2

**Tanggal audit:** 1 Oktober 2026  
**Status:** **GATE 8 OPEN — alur browser utama lulus; TRACE AI live dan render PDF di browser peserta masih memerlukan bukti akhir.**  
**Batas kerja:** Gate 8 saja. Tidak ada pekerjaan Gate 9/10, perubahan data sumber, atau perubahan Golden DB.

## A. Snapshot repositori

- Snapshot otoritatif: `SYNKARA_TRACE_MI_Gate7_RCA_PDF_Fix_2026-09-30.zip`; SHA-256 `961C181A37212C342891504886AC724FF0B35F6A6764F9C263FE12430F1552AA`.
- Root aplikasi: `synkara-trace-mi/`; React 19, Vite 8.3.1, TypeScript 6, Supabase JS 2. `package-lock.json` ada. Arsip bukan repositori Git dan memuat satu root aplikasi.
- Arsip asal menyertakan `node_modules`, `dist`, serta `.env.local` berisi nilai tersamarkan. Dokumen Gate 7 menyatakan ZIP tidak menyertakannya; ini ketidaksesuaian paket/dokumentasi. Paket audit baru mengecualikan ketiganya.
- Konfigurasi ZIP tidak menunjuk ke proyek Supabase yang valid. Pengguna kemudian menegaskan runtime yang dimaksud adalah proyek **development** `bwozyfxcdtouihrnugpe`. Untuk uji lokal, hanya URL dan *publishable key* proyek ini dipasang pada salinan kerja. Tidak ada kunci atau sandi dalam paket keluaran.
- Dokumen `DEPLOYMENT_READINESS.md` lama masih menyebut proyek Golden `jcnabuwkcmajicoxskwa` sebagai kandidat kanonis. Keputusan target deployment perlu diselaraskan dengan penegasan pengguna sebelum rilis; audit ini tidak mengubah database mana pun.

## B. Isu ditemukan

| Prioritas | Temuan | Dampak |
|---|---|---|
| P0 / uji awal terselesaikan | Email pertama yang diberikan tidak terdaftar di Auth development/Golden. Setelah pengguna memberi akun demo yang aktif, login pada development berhasil. | Alur juri kini dapat diuji. Tidak ada akun/keanggotaan baru yang dibuat. |
| P0 / lingkungan terbuka | `.env.local` dalam arsip berisi placeholder untuk URL, publishable key, dan kunci Gemini. Variabel `GEMINI_API_KEY` pada shell juga berbeda dari nilai file dan merupakan nilai lama. | ZIP asal tidak siap dijalankan langsung; TRACE AI live belum dapat diuji secara sah. |
| P1, diperbaiki | Deep link ke halaman terlindungi tanpa sesi menampilkan “Access could not be checked” karena `AuthSessionMissingError` dianggap galat layanan. | Pengunjung belum login mendapat halaman galat alih-alih halaman masuk. |
| P1, terbuka | `api/assistant.js` memanggil `callGemini` untuk kedua mode, sedangkan README/dokumen menyatakan replay sebelum kejadian selalu memakai ringkasan deterministik. Data replay tetap dibatasi cutoff pada jalur kode yang diperiksa. | Kontrak perilaku replay dan dokumentasinya belum selaras ketika kunci model valid tersedia. Tidak diubah karena uji provider live terhalang. |
| P2, terbuka | Halaman Evidence assistant memakai kalimat “Generated wording is a draft” juga pada fallback tanpa model; ringkasan Investigation utama sudah berlabel benar. | Perlu penyelarasan redaksi agar tidak menimbulkan kesan model dipakai pada fallback. |

## C. Perbaikan P0

Tidak ada perubahan kode P0 yang diperlukan pada alur yang berhasil diuji. Masalah akun pertama diselesaikan dengan akun demo aktif yang disediakan pengguna, tanpa mutasi Auth/database. Jalur TRACE AI live tetap environment-blocked; tidak ada perbaikan semu pada model atau database.

## D. Perbaikan P1

`AuthGuard.tsx` sekarang mengarahkan `AuthSessionMissingError` ke `/login`, sambil tetap mempertahankan tampilan galat untuk kegagalan autentikasi lain. Setelah patch, refresh deep link `/dashboard/problem-tank` tanpa sesi benar-benar berakhir di `/login`.

## E. File berubah

- Kode: `src/app/AuthGuard.tsx`, satu baris. SHA-256 sebelum `0FA6C0563C25D4C44BBC4E588162636DFA66B8D28F8AB8E90FE38634D7DFE2E6`; sesudah `02B9EF3986E4E5CB68E223149FCE2FBD2976198D2212F37CA97FA483238266B4`.
- Laporan audit ini ditambahkan ke paket sebagai `docs/GATE8_FINAL_REPORT.md`.
- `.env.local` pada salinan kerja hanya dipakai untuk uji dengan koneksi publik development; **tidak** dimasukkan ke paket. File sumber lain tidak diedit.

## F. Perubahan database

**Nihil.** Tidak ada insert, update, delete, migrasi, perubahan Auth, atau perubahan membership pada development maupun Golden. Query audit memakai `SELECT` saja. Akun uji tidak dibuat karena hal itu mengubah akses aplikasi.

## G. Diagnosis TRACE AI

- Frontend mengirim POST `/api/assistant` dengan bearer session; handler memvalidasi token, keanggotaan aktif, dan data yang boleh dibaca. Tanpa bearer, endpoint lokal mengembalikan JSON **401** sebagaimana mestinya.
- Placeholder Gemini di ZIP bukan kredensial live. `vite.config.ts` mendahulukan `process.env.GEMINI_API_KEY` jika sudah terisi; ini menjelaskan risiko variabel shell lama yang pernah ditemukan. Pada uji kali ini kunci model tidak digunakan.
- Jalur kode menyediakan hasil `generated=true` hanya ketika respons model terurai dan disanitasi; jika tidak, fallback source-bound digunakan. Antarmuka membedakan `AI DRAFT · VERIFY BEFORE USE` dan `SOURCE-BOUND SUMMARY · NO MODEL GENERATED`.
- Replay meng-query fungsi cutoff dan tidak mengambil RCA/insiden masa depan pada jalur kode yang diperiksa. Namun pemanggilan Gemini yang tidak dibatasi mode bertentangan dengan janji replay deterministik; penyelarasan dan uji ulang diperlukan sebelum closure.
- **TRACE fallback terautentikasi: PASS.** Pada Investigation KO-3201 muncul `SOURCE-BOUND SUMMARY · NO MODEL GENERATED`, `CAUSE UNDETERMINED`, fakta dan evidence registry; tombol `Review as action draft` membuka DraftComposer terisi tanpa menyimpan aksi. Evidence assistant replay cutoff 22 April juga memberi ringkasan source-bound tanpa RCA/insiden masa depan.
- **TRACE live: TIDAK DIUJI.** Kunci Gemini valid tidak tersedia dalam snapshot. Jangan menyebut jalur live PASS.

## H. Hasil penerimaan runtime

| Jalur Gate 8 | Hasil | Bukti / batas |
|---|---|---|
| Startup, login, AuthGuard | PASS | Vite port 5174; akun demo kedua berhasil masuk; halaman terlindungi tanpa sesi mengarah ke login. Tidak ada error/warning console yang terlihat sepanjang alur. |
| Overview dan navigasi hero | PASS | 380 insiden, actual/potential terpisah, Energy eksternal jelas; hero tertinggi KO-3201 membuka Investigation. |
| Problem Tank & KO-3201 | PASS | Daftar 380 insiden; filter ZCU/April menghasilkan tiga; Investigation menunjukkan ZCU, 29 Apr, 32 jam, 1.584 kUSD actual, 475,2 kUSD potential. |
| Replay 22/15/8 Apr | PASS | Browser menunjukkan empat ukuran 22 Apr (71,674 micron; 1.372,791 ppm; 1,122 barg; 107,142 °C), ALARM, riwayat 15/8 Apr, dan Production per jam terpisah. RPC dan UI tidak menampilkan baris 29 Apr atau kesimpulan RCA pada replay. |
| Investigation, TRACE fallback, TRACE → Action | PASS untuk jalur tanpa model | Ringkasan berlabel fallback dan cause undetermined; evidence registry dan tautan tampil. Prefill masuk ke DraftComposer; draft ditutup tanpa disimpan sehingga tidak ada aksi duplikat. TRACE live tetap belum diuji. |
| Actions V2 | PASS | Action `cc242cc7-0e7c-484d-998a-54cebfe7b2fc` terbuka dan tetap terpilih sesudah refresh; verified, Reliability, Standard, tenggat, bukti sumber dan lima event tampil. Verified hanya review demo. |
| RCA × 5 | PASS struktur/data; render visual perlu Chrome | Kelima pilihan browser menampilkan iframe PDF yang benar, tautan direct-open, dan blok ekstraksi slide sesuai deck (total 55), semuanya masih pending visual review. Lima file HTTP 200/PDF valid, halaman 3/3/4/4/11. Browser internal Codex menampilkan permukaan PDF hitam bahkan pada URL langsung; kemampuan render PDF di Chrome pengguna masih harus dilihat manual. |
| Energy eksternal | PASS | Label UCI baja Korea Selatan 2018 terlihat. Cutoff 35036: 15,40/14,97/0,43 kWh; 32100: 20,88/115,80/94,92 kWh. Actual tersembunyi sebelum Reveal, selisih biaya dilabeli error bukan saving. Cutoff berubah saat request pending tidak membawa hasil lama; Back/Forward menyetel ulang reveal dengan benar. |
| Source links, back/forward, refresh terautentikasi | PASS terbatas | Deep link Incident row 5, Equipment row 21, Energy CSV sequence 35036 membuka catatan tepat; action deep link tetap terpilih setelah reload. Jalur Energy Back/Forward lulus. |
| Tata letak | PASS terbatas | Login pada 1366×768 dan 390×844 tidak meluap; halaman terautentikasi pada lebar browser internal normal tidak menunjukkan overflow. Uji mobile seluruh halaman perlu browser peserta. |

## I. Typecheck

`npm run typecheck`: **PASS** setelah patch.

## J. Build dan validasi tambahan

- `npm run build`: **PASS**, 95 modul. Tidak ada kesalahan kompilasi.
- `node --check api/assistant.js`: **PASS**.
- `scripts/validate_data.py`: **PASS** (380 insiden, 3.600 Production, 130 Condition History, 5 RCA/55 slide, 35.040 baris energi, 5.277 cutoff).
- `scripts/verify_prototype.py`: **PASS** untuk total sumber, cutoff KO, perbedaan HE OFF, tiga cutoff forecast, dan flag visual RCA.
- `npm run check:config`: **PASS** pada konfigurasi uji development yang benar; konfigurasi placeholder dari ZIP asal memang tidak valid.
- ZIP kandidat audit diekstrak ulang ke folder bersih: `npm ci` normal **PASS**, kemudian `npm run typecheck` dan `npm run build` **PASS**. `.env.local`, `node_modules`, dan `dist` tidak ada dalam ZIP.

## K. Batas yang masih diketahui

1. Kunci Gemini live tidak tersedia dalam snapshot yang diberikan. Jalur live tidak boleh disebut PASS; fallback terautentikasi sudah PASS.
2. Kontrak replay deterministik perlu diselaraskan dengan pemanggilan Gemini yang saat ini berlaku untuk semua mode. Redaksi fallback di Evidence assistant juga perlu diperjelas.
3. Browser internal Codex tidak merender PDF, termasuk ketika URL PDF dibuka langsung. File, link dan mapping valid; periksa render kelima PDF di Chrome peserta sebelum klaim visual PASS.
4. Semua 55 slide RCA masih menunggu pemeriksaan visual terhadap PPTX asli. Team Rendition PDF adalah alat orientasi, bukan pengganti sumber otoritatif.
5. Keputusan target deployment perlu diselaraskan dengan dokumen lama yang menyebut Golden. Golden tidak disentuh dalam audit ini.
6. Filter ad hoc di Problem Tank bekerja, tetapi tidak otomatis menulis pilihan ke URL; refresh pada URL tanpa parameter mengembalikan filter awal. Deep link yang membawa parameter tetap dapat digunakan.

## L. Pemeriksaan manual yang diperlukan

1. Isi `.env.local` sendiri dari `.env.example` dengan URL dan publishable key development. Jika kunci Gemini valid tersedia, letakkan `GEMINI_API_KEY` hanya pada server; bersihkan variabel shell lama sebelum start. Jangan memakai `VITE_PUBLIC_` untuk kunci model atau menaruh sandi di ZIP.
2. Jalankan TRACE retrospective dengan provider live dan pastikan label `AI DRAFT · VERIFY BEFORE USE`, output source-bound, serta fallback tetap berlabel jujur ketika provider tidak tersedia. Selaraskan kontrak replay deterministik dengan kode setelah kunci live tersedia.
3. Pada Chrome yang akan dipakai presentasi, periksa kelima PDF benar-benar menampilkan halaman, tombol buka tab baru, dan layout pada lebar laptop/mobile. Browser internal pada audit ini tidak memiliki render PDF yang dapat dinilai.
4. Putuskan dan dokumentasikan target deployment development vs Golden secara konsisten sebelum rilis. Jangan mengubah Golden untuk menyelesaikan perbedaan dokumen ini.

## M. Kesiapan menuju Gate 10

**GATE 8 OPEN, mayoritas jalur juri PASS.** Login dan alur inti telah terbukti di browser, satu bug deep link telah diperbaiki, dan paket bersih lolos instalasi/typecheck/build. Sebelum Gate 10 preparation, uji TRACE live dengan kunci valid, selaraskan replay deterministik, dan verifikasi render PDF di Chrome peserta. Gate 9/10 belum dimulai.
