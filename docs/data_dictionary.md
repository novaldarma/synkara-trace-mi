# Data Dictionary — SYNKARA TRACE-MI

**Proyek:** CALIBER 2026, Case 2 — Manufacturing Intelligence  
**Status:** peta data sumber untuk prototipe; diverifikasi terhadap workbook dan ZIP yang tersedia serta spesifikasi proyek v3  
**Tujuan:** menjelaskan asal, arti, satuan, waktu, identitas, cakupan, dan batas pemakaian setiap data sebelum membuat tabel Supabase atau menghitung KPI.

## 1. Aturan membaca kamus

| Label          | Arti                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `provided`     | Nilai/kolom yang memang diberikan oleh berkas sumber; tidak otomatis berarti sudah tervalidasi sebagai konfigurasi pabrik sesungguhnya. |
| `team-defined` | ID teknis, hasil transformasi, asumsi skenario, perhitungan, atau keputusan yang dibuat tim. Simpan aturan dan versinya.                |
| `unavailable`  | Data tidak disediakan oleh sumber yang dipakai; jangan diganti nol atau dikarang.                                                       |

**Tiga jenis data harus dipisah:** `source` menyimpan nilai asli dan asalnya; `derived` menyimpan hasil hitung beserta rumus dan versinya; `user_action` menyimpan keputusan pengguna seperti persetujuan tindakan. Konversi ke Markdown hanya menyiapkan potongan bukti untuk AI: workbook, tabel terstruktur, dan relasi sumber tetap menjadi acuan untuk angka.

Setiap baris yang diimpor perlu jejak `dataset_id`, nama file, nama sheet atau nomor slide, nomor baris asli jika relevan, versi/checksum file, waktu impor, dan nilai mentah yang memungkinkan penelusuran. ID internal dapat dibentuk dari identitas sumber + baris/slide asli; ID tersebut `team-defined`, bukan nomor resmi perusahaan. Jangan menganggap waktu impor sebagai waktu kejadian.

| Waktu              | Makna dan aturan                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `source_timestamp` | Tanggal/jam pengukuran sebagaimana tertulis di file; simpan juga nilai mentah dan granularitasnya. |
| `occurred_at`      | Tanggal kejadian insiden sebagaimana tercatat; tidak selalu memiliki jam.                          |
| `reported_at`      | Waktu laporan jika sumber menyatakannya; bukan otomatis waktu hasil investigasi tersedia.          |
| `available_at`     | Saat suatu informasi dapat diketahui pengguna; `unavailable` bila sumber tidak membuktikannya.     |
| `imported_at`      | Saat tim memasukkan sumber ke sistem; `team-defined`.                                              |

Tanggal/jam Case 2 tidak mencantumkan zona waktu yang terverifikasi. Pertahankan teks asli dan jangan menambahkan zona waktu fiktif. Untuk simulasi sebelum insiden, tampilkan hanya bukti yang sudah tersedia pada titik waktu yang dipilih; bila ketersediaannya tidak dapat dibuktikan, jangan menyajikannya sebagai pengetahuan pada waktu tersebut. Tanggal tanpa jam pada `Condition History` aman diperlakukan sebagai tersedia **setelah akhir tanggal** atau mulai hari berikutnya untuk replay, dengan aturan ini ditandai sebagai asumsi tim.

## 2. Katalog sumber dan cakupan

| Sumber                                                                                                  | Isi yang digunakan                                        | Jumlah dan granularitas                                                                           | Status dan batas                                                            |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Incident Database.xlsx` → `Incident Database`                                                          | Insiden, downtime, kerugian, klasifikasi risiko, status   | 380 baris insiden; satu baris = satu insiden; 12 label plant; 2024-01-04 s.d. 2026-07-25          | `provided`; ringkasan historis, bukan seluruh kejadian/kerugian perusahaan. |
| File yang sama → `Dashboard`                                                                            | Ringkasan bawaan file untuk rekonsiliasi                  | Ringkasan, bukan insiden tambahan                                                                 | `provided`; jangan diimpor sebagai baris insiden kedua kali.                |
| Lima `Production Data - RCA*.xlsx` → `PI Tag`, `Sheet2`                                                 | Metadata tujuh tag dan pengamatan proses                  | Setiap file: 7 metadata tag dan 720 observasi per jam selama 30 hari; total 3.600 baris observasi | `provided`; hanya lima aset dalam empat label plant.                        |
| Lima `Equipment Performance - RCA*.xlsx` → `Equipment Info`, `Condition History`, `Performance Summary` | Metadata aset/ambang, kondisi mingguan, KPI bawaan        | Setiap file: 26 observasi mingguan; total 130; KPI summary per aset                               | `provided`; lima aset, bukan seluruh peralatan di 12 plant.                 |
| Lima `RCA*.pptx`                                                                                        | Laporan historis dan bukti penyelidikan                   | 11 slide per presentasi; total 55 slide                                                           | `provided`; tanggal tersedianya kesimpulan akhir tidak terverifikasi.       |
| `Data Set Explanation for Case 2...pptx`                                                                | Penjelasan konteks dataset                                | Dokumen penjelasan                                                                                | `provided`; jangan perlakukan klaim potensi sebagai hasil terukur.          |
| `Steel_industry_data.csv` dari arsip UCI                                                                | Riwayat pemakaian listrik fasilitas baja di Korea Selatan | 35.040 observasi tahun 2018, nominal tiap 15 menit, 11 kolom                                      | **Sumber eksternal**, bukan meter listrik atau emisi Chandra Asri.          |

Tidak ditemukan file **Downtime Data terpisah** pada baseline Case 2 yang menjadi acuan spesifikasi v3. Downtime yang dipakai berasal dari kolom insiden serta lima RCA/summary aset, dengan asal dan kemungkinan pengulangan angka dinyatakan jelas.

**Batas cakupan:** ringkasan insiden meliputi 12 label plant, sedangkan tren rinci Production dan Equipment hanya lima aset pada ARP, ZCU, NUP, dan OPP. Jika pengguna memilih plant atau aset tanpa pengukuran rinci, tampilkan `measurement unavailable`, bukan garis datar bernilai nol. Lima RCA yang disediakan tidak membuktikan bahwa 375 insiden lain tidak mempunyai RCA di dunia nyata; label yang tepat adalah _RCA not supplied in competition baseline_.

### Lima aset yang mempunyai data rinci

| Paket | Aset     | Plant di Incident | Periode Production per jam | Periode Condition History mingguan | AR rujukan         |
| ----- | -------- | ----------------- | -------------------------- | ---------------------------------- | ------------------ |
| RCA1  | PU-2101B | ARP               | 2026-03-01 s.d. 2026-03-30 | 2025-10-23 s.d. 2026-04-16         | `AR-2026-ARP-0117` |
| RCA2  | KO-3201  | ZCU               | 2026-04-01 s.d. 2026-04-30 | 2025-12-10 s.d. 2026-06-03         | `AR-2026-ZCU-0142` |
| RCA3  | PM-4405B | NUP               | 2026-07-01 s.d. 2026-07-30 | 2026-02-18 s.d. 2026-08-12         | `AR-2026-NUP-0089` |
| RCA4  | HE-3301  | ZCU               | 2026-05-01 s.d. 2026-05-30 | 2026-01-01 s.d. 2026-06-25         | `AR-2026-ZCU-0165` |
| RCA5  | BL-5702  | OPP               | 2026-06-01 s.d. 2026-06-30 | 2026-01-28 s.d. 2026-07-22         | `AR-2026-OPP-0203` |

Periode Production dan Equipment tidak identik. Data setelah tanggal insiden tidak boleh terlihat dalam simulasi yang mengaku terjadi sebelum insiden.

## 3. Incident Database

**Berkas/sheet:** `Incident Database.xlsx` / `Incident Database`. Judul ada di baris Excel 1, baris 2 kosong, **header sesungguhnya di baris 3**, dan 380 baris data mulai baris 4. Gunakan nomor baris asli bersama identitas file sebagai ID internal stabil. `Serial No`, `AR No.`, dan `MTO No.` tetap disimpan sebagai kolom sumber; AR/MTO tidak memenuhi syarat primary key tunggal. Sheet `Dashboard` dipakai untuk membandingkan total, bukan dijumlah lagi.

| Kolom persis dari sumber | Makna                            | Tipe/satuan, catatan                                                                                         |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Serial No`              | Nomor urut pada workbook         | Angka sumber; jangan jadi kunci lintas versi file.                                                           |
| `MTO No.`                | Referensi MTO                    | Teks; ada nomor yang berulang.                                                                               |
| `AR No.`                 | Referensi abnormality report     | Teks; `n/a` pada 226 insiden dan ada nomor yang berulang.                                                    |
| `Plant`                  | Kode plant/unit menurut insiden  | Teks kategori; 12 label berbeda.                                                                             |
| `Tag Number`             | Tag alat yang terkait            | Teks; kunci kandidat penghubung dengan lima aset rinci.                                                      |
| `Eq. Class`              | Kelas peralatan                  | Kategori sumber; jangan menyamakannya dengan skor numerik.                                                   |
| `Date of Occur.`         | Tanggal kejadian                 | Tanggal tanpa jam/zona waktu terverifikasi.                                                                  |
| `Risk Case Title`        | Judul masalah                    | Teks.                                                                                                        |
| `Highest Impact`         | Kategori dampak tertinggi        | Teks sumber.                                                                                                 |
| `Pre-Risk`               | Kategori risiko awal             | Kode kategori sumber; aturan penilaiannya tidak diberikan.                                                   |
| `Risk Score`             | Skor risiko yang sudah dicatat   | Angka sumber; rumus pembentuknya tidak diberikan.                                                            |
| `PIC (RCA)`              | Penanggung jawab menurut file    | Teks snapshot sumber, bukan penugasan pengguna yang hidup.                                                   |
| `Overall Status`         | Status menurut file              | Teks snapshot; waktu perubahan status tidak tersedia.                                                        |
| `Discipline`             | Disiplin terkait                 | Kategori sumber.                                                                                             |
| `Eq. Type`               | Jenis alat                       | Kategori sumber.                                                                                             |
| `Component`              | Komponen terkait                 | Teks sumber.                                                                                                 |
| `F Mechanism`            | Mekanisme kegagalan menurut file | Teks/kategori; jangan menganggapnya prediksi yang sudah tersedia sebelum kejadian.                           |
| `Downtime (hrs)`         | Durasi downtime tercatat         | Jam; tidak diturunkan dari jumlah baris `RUN_STATUS=OFF`.                                                    |
| `Act. Loss (k US$)`      | Kerugian aktual tercatat         | Ribu dolar AS, `k US$`.                                                                                      |
| `Pot. Loss (k US$)`      | Kerugian potensial tercatat      | Ribu dolar AS, `k US$`; bukan kerugian aktual.                                                               |
| `Total Loss (k US$)`     | Jumlah kerugian versi sumber     | Ribu dolar AS; periksa sebagai actual + potential, jangan artikan semuanya realisasi.                        |
| `RCA Due Date`           | Tenggat RCA menurut file         | Tanggal target bila tersedia; 197 baris berisi teks `n/a`, bukan tanggal selesai atau tanggal publikasi RCA. |
| `Month - Year`           | Label bulan/tahun                | Teks sumber; jangan ganti tanggal kejadian dengan label ini.                                                 |

**Rekonsiliasi sumber:** 380 insiden; downtime 2.261,1 jam; actual loss 61.886,46 k US$; potential loss 5.307,97 k US$; total loss 67.194,43 k US$ = actual + potential. Bila UI menampilkan total tersebut, beri label jelas bahwa angka mencakup kerugian potensial. Ini **bukan** penghematan yang telah dicapai TRACE-MI. `AR-2026-OP2-0171` dan `AR-2024-ZCU-0236` masing-masing muncul dua kali; `MTO-2026-OPP-0096` juga muncul dua kali. Simpan masing-masing baris sebagai insiden tersendiri sampai keterkaitannya diperiksa.

## 4. Production Data

**Berkas:** `Production Data - RCA1 PU-2101B.xlsx` hingga `Production Data - RCA5 BL-5702.xlsx`. Tiap workbook memuat:

| Sheet    | Struktur dan makna                                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PI Tag` | Header baris 1: `Name`, `Description`, `digitalset`, `engunits`, `span`, `typicalvalue`, `zero`, `instrumenttag`. Tujuh baris metadata, bukan tujuh pengamatan. `span`, `typicalvalue`, `zero` adalah metadata sumber; **jangan** menganggap `span` ambang alarm resmi. |
| `Sheet2` | Header baris 1: `Timestamp`, lima tag khusus aset (`*_FEED`, `*_DISP`, `*_VIB`, `*_TEMP`, `*_AMP`), `PLANT_RATE`, `RUN_STATUS`. Baris 2–721 = 720 observasi per jam; timestamp berupa teks `YYYY-MM-DD HH:MM:SS` tanpa zona waktu terverifikasi.                        |

| Kolom seri `Sheet2` | Unit sesuai `PI Tag`                  | Makna dan batas                                                                          |
| ------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Timestamp`         | Tanggal dan jam                       | Identitas waktu pengamatan untuk **aset dan file tersebut**.                             |
| `<ASSET>_FEED`      | `T/H`; khusus PM-4405B `T/H (equiv.)` | Laju feed sebagaimana dilabel sumber; jangan mengubah `equiv.` menjadi tonase aktual.    |
| `<ASSET>_DISP`      | `BARG`                                | Tekanan discharge.                                                                       |
| `<ASSET>_VIB`       | `MM/S`                                | Getaran PI Tag; bukan otomatis parameter Equipment dengan nama mirip.                    |
| `<ASSET>_TEMP`      | `DEG C`                               | Suhu pada tag sumber.                                                                    |
| `<ASSET>_AMP`       | `A`                                   | Arus listrik; **bukan** kWh, daya, atau konsumsi listrik.                                |
| `PLANT_RATE`        | `T/H`; khusus PM-4405B `T/H (equiv.)` | Laju dalam konteks file/aset tersebut; tidak mewakili total lintas plant.                |
| `RUN_STATUS`        | `ON_OFF`                              | Keadaan ON/OFF pada titik jam pengamatan; tidak otomatis sama dengan jam downtime resmi. |

Nama `PLANT_RATE` dan `instrumenttag` `PLTRMT.PV` dipakai ulang di lima file. Kunci yang aman untuk satu pengamatan adalah kombinasi **file/dataset + aset + baris/timestamp**, bukan nama PI Tag global saja. Jangan menjumlahkan lima `PLANT_RATE` sebagai produksi gabungan, karena periode, plant, dan semantik `T/H (equiv.)` berbeda. PI Tag HE-3301 memuat `AMP`/`VIB` generik meskipun alatnya heat exchanger; keberadaan kolom tidak membuktikan konfigurasi instrumen nyata. Jumlah pengamatan OFF berbeda dari downtime insiden pada HE-3301 (**13** pengamatan versus **12** jam) dan PU-2101B (**18** pengamatan versus **18,5** jam). Pakai `Downtime (hrs)` untuk KPI downtime resmi baseline dan simpan perbedaan ini di audit.

## 5. Equipment Performance

**Berkas:** `Equipment Performance - RCA1 PU-2101B.xlsx` hingga `Equipment Performance - RCA5 BL-5702.xlsx`. Setiap workbook mempunyai tiga sheet berikut.

| Sheet                 | Letak dan isi                                                                                                                                                                                                                                                                                                                                    | Grain                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `Equipment Info`      | Dua pasangan kolom: label–nilai identitas alat di kiri, parameter–teks `Alarm / Trip` di kanan. Nilai metadata meliputi `Equipment Tag`, `Equipment Name`, `Equipment Type`, `Equipment Class`, `Plant / Unit`, `Discipline`, `Criticality`, `Design Life`, `Monitoring Method`, `Linked RCA / AR No.`, `Failure Date`, `Dominant Failure Mode`. | Satu paket metadata per aset; beberapa nilai adalah pengetahuan pascainsiden. |
| `Condition History`   | Kolom `Week`, `Date`, empat parameter khusus aset, `Health Status`, `Remark`. Header di baris 1 dan 26 baris pengamatan di baris 2–27.                                                                                                                                                                                                           | Mingguan; tanggal saja, tanpa jam.                                            |
| `Performance Summary` | Header `KPI`, `Value`, `Basis / Formula` setelah baris judul; 13 baris KPI.                                                                                                                                                                                                                                                                      | Ringkasan periode dalam file, bukan pengamatan mingguan baru.                 |

### Parameter Condition History dan batas pada Equipment Info

Nilai berikut disalin dari pasangan `Alarm / Trip` sumber. Beberapa alarm terjadi saat nilai **turun** (misalnya flow/pressure/duty), lainnya saat nilai **naik**. Pertahankan `Health Status` asli dan validasi arah tiap parameter sebelum menurunkan status tambahan.

| Aset     | Parameter persis dari sumber | Unit     | Alarm | Trip |
| -------- | ---------------------------- | -------- | ----: | ---: |
| PU-2101B | Overall Vibration            | mm/s     |   7.0 | 11.0 |
| PU-2101B | Seal Flush Flow              | L/min    |   5.0 |  4.0 |
| PU-2101B | Discharge Pressure           | barg     |   8.5 |  7.5 |
| PU-2101B | Bearing Temp                 | °C       |    80 |   95 |
| KO-3201  | DE Radial Vibration          | micron   |    45 |   75 |
| KO-3201  | Lube Oil Water Content       | ppm      |   500 | 1500 |
| KO-3201  | Lube Oil Supply Press        | barg     |   1.4 |  1.1 |
| KO-3201  | Bearing Metal Temp           | °C       |    95 |  110 |
| PM-4405B | Motor DE Bearing Temp        | °C       |    75 |   90 |
| PM-4405B | Motor Vibration              | mm/s     |   5.0 |  8.0 |
| PM-4405B | Motor Ampere                 | A        |   150 |  165 |
| PM-4405B | Winding Temp                 | °C       |   120 |  140 |
| HE-3301  | Tube-side dP                 | bar      |   0.6 |  0.9 |
| HE-3301  | Heat Duty                    | % design |    90 |   70 |
| HE-3301  | Cold Outlet Temp             | °C       |   110 |   95 |
| HE-3301  | Feed Heavy-ends              | %        |   1.5 |  2.4 |
| BL-5702  | Overall Vibration            | mm/s     |   7.0 | 11.0 |
| BL-5702  | 2X Harmonic                  | mm/s     |   3.0 |  5.0 |
| BL-5702  | Coupling Offset              | mm       |  0.05 |  0.3 |
| BL-5702  | Bearing Temp                 | °C       |    80 |   95 |

`Health Status` adalah `NORMAL`, `ALARM`, atau `TRIP` sebagaimana tertulis dalam observasi. KO-3201 mempunyai `DE Radial Vibration` dalam **micron** pada Equipment, sedangkan `KO3201_VIB` pada Production dalam **MM/S**: dua parameter berbeda, tidak boleh langsung ditumpuk atau dibandingkan angka ambangnya. `Equipment Info` KO menyebut alarm/trip 45/75 micron; RCA juga menyebut alert 60 micron. Istilah dan pengukurannya belum dibuktikan setara, sehingga tampilkan bersama asalnya tanpa memilih satu sebagai standar operasional. Informasi `Design Life`/`Monitoring Method` tampak generik bahkan pada HE-3301; jangan mengklaim semua detail itu konfigurasi instrumentasi pabrik yang sudah diverifikasi.

### Daftar KPI bawaan Performance Summary

Header persis `KPI`, `Value`, `Basis / Formula`. KPI sumber: `Monitoring Period (weeks)`, `Total Downtime (hours)`, `Period Hours`, `Availability (%)`, `No. of Failures (period)`, `MTBF (hours)`, `MTTR (hours)`, `ALARM readings`, `TRIP readings`, `NORMAL readings`, `PM Compliance (%)`, `Production Loss (ton)`, dan `Estimated Loss (k USD)`.

Lima summary masing-masing mencantumkan `Monitoring Period (weeks) = 26` dan `Period Hours = 4368`. Rentang tanggal antara 26 titik pembacaan tidak otomatis membuktikan tepat 4.368 jam periode pemantauan; perlakukan `Period Hours` sebagai nilai **summary bawaan**, bukan hasil baru dari timestamp mingguan. `Total Downtime` dan `Estimated Loss` juga dapat merujuk kejadian yang sudah ada di Incident/RCA, sehingga jangan menjumlahkannya lagi ke agregat insiden. Pada PM-4405B, `Production Loss (ton)` tetap label summary sumber meski Production memakai `T/H (equiv.)`; belum boleh disebut tonase terukur mandiri. KPI summary seluruh periode tidak boleh ditampilkan pada replay sebelum insiden bila menghimpun data masa depan.

## 6. RCA dan hubungan kasus

Setiap presentasi RCA1–RCA5 memiliki 11 slide; simpan `source_file`, `slide_number`, teks/objek yang berhasil diekstrak, dan pemeriksaan manual untuk tabel/diagram yang ekstraksi teksnya tidak lengkap. Nomor AR pada slide pembuka sesuai tabel lima aset di §2. Hubungkan tiap RCA dengan insiden menggunakan **tag alat + plant + tanggal kejadian**, lalu cocokkan AR bila tersedia; catat bahwa tautan sudah diverifikasi, jangan mengandalkan kesamaan judul saja.

| Slide | Pokok isi untuk pengindeksan                       |
| ----: | -------------------------------------------------- |
|     1 | Abnormality Report: identitas kasus.               |
|     2 | Problem Identification.                            |
|     3 | General Process Overview / Chronology.             |
|     4 | Past Performance.                                  |
|     5 | Target Setting.                                    |
|     6 | Parameter Verification (4P).                       |
|     7 | 4M+1E Verification dan akar penyebab yang dicatat. |
|     8 | Matrix Priority.                                   |
|     9 | Corrective / Pro-active Actions.                   |
|    10 | Preventive / Risk Analysis.                        |
|    11 | Downtime / Closure Summary.                        |

Pisahkan **kronologi, observasi, kesimpulan, dan tindakan historis** ketika menyiapkan teks untuk AI. `Date Reported` pada RCA bukan tanggal terverifikasi bahwa semua kesimpulan atau tindakan di slide akhir sudah diketahui; tanpa tanggal publikasi/finalisasi, kesimpulan RCA tidak dimasukkan dalam mode sebelum insiden. Tindakan yang tertulis pada RCA adalah catatan historis, bukan `user_action` aktif pada aplikasi. `Linked RCA / AR No.`, `Failure Date`, dan `Dominant Failure Mode` di Equipment Info juga harus disembunyikan dalam replay sebelum kejadian.

## 7. Data energi eksternal

**Berkas:** `Steel_industry_data.csv` dalam `steel+industry+energy+consumption.zip`; fasilitas industri baja di Korea Selatan, tahun 2018. Satu baris = satu catatan nominal 15 menit, total 35.040 baris; 96 catatan untuk setiap label tanggal sumber, tidak ada sel kosong pada 11 kolom CSV yang diperiksa. Sumber ini diberi `dataset_id` **eksternal** dan dipisahkan dari plant/asset Case 2. Data listrik, tarif, dan emisi Chandra Asri **unavailable** pada baseline.

| Kolom persis CSV                       | Makna/unit sumber                            | Aturan penggunaan                                                                                                    |
| -------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `date`                                 | Label tanggal dan waktu (`DD/MM/YYYY HH:MM`) | Simpan teks asli, nomor baris, dan urutan file. Aturan `00:00` dijelaskan di bawah.                                  |
| `Usage_kWh`                            | Pemakaian listrik dalam kWh menurut file     | Target forecast empat interval berikutnya; definisi batas interval diperiksa sebelum melabel total satu jam.         |
| `Lagging_Current_Reactive.Power_kVarh` | Energi reaktif lagging, kVarh                | Fitur historis hanya jika tersedia sebelum cutoff; bukan kWh aktif.                                                  |
| `Leading_Current_Reactive_Power_kVarh` | Energi reaktif leading, kVarh                | Sama; jangan jumlahkan dengan `Usage_kWh`.                                                                           |
| `CO2(tCO2)`                            | Kolom CO₂ dalam tCO₂ menurut file            | Data eksternal; tidak boleh menjadi KPI emisi Chandra Asri. Banyak nol perlu konteks/pemeriksaan sebelum dianalisis. |
| `Lagging_Current_Power_Factor`         | Faktor daya lagging, angka sumber            | Bukan persen emisi atau kWh.                                                                                         |
| `Leading_Current_Power_Factor`         | Faktor daya leading, angka sumber            | Bukan tarif listrik.                                                                                                 |
| `NSM`                                  | Seconds since midnight menurut dataset       | Bantu pemeriksaan urutan waktu; bukan energi.                                                                        |
| `WeekStatus`                           | Kategori weekday/weekend                     | Kategori kalender sumber.                                                                                            |
| `Day_of_week`                          | Nama hari                                    | Kategori kalender sumber.                                                                                            |
| `Load_Type`                            | Light/Medium/Maximum load menurut file       | Kategori eksternal; definisi ketersediaan sebelum cutoff perlu diverifikasi sebelum dijadikan fitur prediksi.        |

**Urutan waktu penting:** `01/01/2018 00:00` berada **setelah** `01/01/2018 23:45` pada urutan baris sumber. Hal yang sama berlaku pada setiap label tanggal. Jika teks `date` langsung diurutkan naik, kronologi berubah dan evaluasi model dapat bocor. Simpan indeks urutan asli; bila sistem membutuhkan timestamp kronologis untuk tampilan/model, petakan `00:00` di akhir blok ke hari berikutnya sebagai **timestamp turunan dengan aturan yang terdokumentasi**, sementara label asli tetap disimpan. Uji 96 baris per tanggal sumber, jarak interval, dan seluruh batas pergantian hari. Akhir file berlabel `31/12/2018 00:00` menurut sumber; penafsiran sebagai akhir hari adalah transformasi tim, bukan perubahan pada file asli.

**Output energi yang sah:** pilihan cutoff historis → histori yang sudah tersedia → prediksi `Usage_kWh` untuk empat langkah 15 menit → jumlah prediksi menjadi estimasi kebutuhan satu jam **jika semantik interval benar** → biaya variabel indikatif US$ = Σ(prediksi kWh interval) × (106,46 KRW/kWh ÷ 1.099,2926 KRW/US$). Harga 2018: [KEA/KEPCO](https://tips.energy.or.kr/statistics/statistics_view0703.do); kurs 2018: [Federal Reserve G.5A](https://www.federalreserve.gov/releases/g5a/20210104/). Simpan acuan/versi model sebagai `team_defined`; pada backtest, sembunyikan empat data setelah cutoff sebelum pengguna meminta reveal. Label yang harus terlihat: **contoh data baja Korea Selatan 2018, bukan prediksi pemakaian, tagihan, tarif fasilitas, atau emisi Chandra Asri**. Jangan gabungkan biaya ini dengan loss Case 2.

## 8. Relasi, KPI, dan data yang belum tersedia

| Kebutuhan                   | Hubungan/rumus yang dibolehkan                                                                                      | Batas                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Insiden ↔ RCA               | Kecocokan terverifikasi tag + plant + tanggal, AR sebagai pemeriksaan tambahan untuk lima kasus.                    | AR/MTO tidak unik untuk seluruh 380 insiden.                                             |
| Insiden ↔ Production        | Tampilkan tren **aset yang sama** hanya pada jam yang tersedia di sekitar tanggal kejadian.                         | Tidak ada bukti `RUN_STATUS=OFF` selalu sama dengan jam downtime insiden.                |
| Insiden ↔ Equipment         | Tampilkan pembacaan mingguan yang relevan untuk **aset yang sama** beserta tanggal dan unitnya.                     | Jangan interpolasi menjadi sensor per jam atau tampilkan pembacaan setelah waktu replay. |
| Overview downtime           | Σ `Downtime (hrs)` dari 380 insiden pada filter yang sama.                                                          | Bukan downtime seluruh operasi/perusahaan.                                               |
| Overview kerugian           | Actual dan potential ditampilkan terpisah; total sumber = actual + potential.                                       | Bukan seluruhnya uang yang sudah hilang atau uang yang diselamatkan prototipe.           |
| Equipment availability/MTBF | Nilai bawaan `Performance Summary` boleh ditampilkan dengan label cakupan 26 minggu/aset.                           | Jangan mengklaim ulang sebagai perhitungan lintas seluruh plant atau sebelum insiden.    |
| Energy forecast/biaya       | Prediksi kWh dari UCI, evaluasi aktual yang ditahan hingga Reveal, dan biaya indikatif dari **harga industri/kurs nasional 2018 yang diterbitkan**; bukan tarif fasilitas. | Tidak boleh dijumlah dengan loss insiden atau diberi label biaya pabrik Case 2.          |

**`unavailable` pada baseline:** konsumsi listrik meter Chandra Asri, tarif kontrak dan tagihan energi perusahaan, register emisi perusahaan, jam pasti ketersediaan semua sumber historis, perubahan status insiden dari waktu ke waktu, target produksi resmi semua aset, sensor terperinci untuk aset lain, serta bukti bahwa tindakan yang diusulkan menghasilkan penghematan nyata. Jika tim mengisi angka skenario, beri label `team-defined scenario`, bukan `provided`.

**Berkas di luar cakupan:** lampiran `Maintenance History (All Equipment).xlsx` yang juga tersedia dalam bahan percakapan berisi 211 work order untuk unit LLDPE dan delapan tag peralatan lain. Berkas tersebut tidak tercantum sebagai sumber Case 2 dalam spesifikasi proyek v3 dan tidak cocok dengan lima tag aset rinci di atas. Jangan memasukkan atau menggabungkannya ke baseline Case 2 tanpa verifikasi asal dan tujuan penggunaannya. Keberadaan teks `Equipment_Tag = JOIN KEY` di sheet penjelasannya tidak membuktikan relasi dengan lima aset Case 2.

## 9. Pemeriksaan sebelum impor

Parser harus menghasilkan tepat **380** baris insiden, **5 × 720** baris Production, **5 × 26** baris Condition History, **5 × 11** slide RCA, dan **35.040** baris UCI. Pada Equipment, header parameter mengandung baris baru di dalam sel; baca workbook dengan parser Excel/CSV yang memahami quoted fields, bukan menghitung jumlah baris dengan memecah teks pada setiap `\n`. Validasi nama kolom, unit, ID dan timestamp mentah, lima tautan RCA, agregat kerugian, serta urutan `00:00` UCI sebelum memasukkan data ke Supabase. Daftar anomali per baris, pertentangan antar sumber, dan keputusan pembersihan ditulis di `docs/data_audit.md`; kamus ini mempertahankan makna sumber.
