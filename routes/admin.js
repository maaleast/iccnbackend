const express = require('express');
const router = express.Router();
const mysql = require('mysql2');
require('dotenv').config();

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const moment = require("moment");


// Koneksi MySQL
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// **GET Semua Data Members & Users**
router.get('/all-members', (req, res) => {
    db.query('SELECT * FROM members', (err, results) => {
        if (err) {
            console.error('❌ Error mengambil data members:', err);
            return res.status(500).json({ message: 'Gagal mengambil data members' });
        }
        res.json(results);
    });
});

router.get('/all-users', (req, res) => {
    db.query('SELECT * FROM users', (err, results) => {
        if (err) {
            console.error('❌ Error mengambil data users:', err);
            return res.status(500).json({ message: 'Gagal mengambil data users' });
        }
        res.json(results);
    });
});

// **GET Detail Member by ID**
router.get('/member/:id', (req, res) => {
    const { id } = req.params;

    db.query('SELECT * FROM members WHERE id = ?', [id], (err, results) => {
        if (err) {
            console.error('❌ Error mengambil detail member:', err);
            return res.status(500).json({ message: 'Gagal mengambil detail member' });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: 'Member tidak ditemukan' });
        }

        res.json(results[0]); // Kirim data member pertama yang ditemukan
    });
});

module.exports = router;

// **UPDATE STATUS VERIFIKASI MEMBER**

router.put('/verifikasi/diterima/:id', (req, res) => {
    const memberId = req.params.id;
    db.query(
        'UPDATE members SET status_verifikasi = "DITERIMA" WHERE id = ?',
        [memberId],
        (err, result) => {
            if (err) {
                console.error('❌ Gagal mengubah status menjadi DITERIMA:', err);
                return res.status(500).json({ message: 'Gagal memperbarui status verifikasi' });
            }
            res.json({ message: 'Status berhasil diperbarui menjadi DITERIMA' });
        }
    );
});

router.put('/verifikasi/ditolak/:id', (req, res) => {
    const memberId = req.params.id;
    db.query(
        'UPDATE members SET status_verifikasi = "DITOLAK" WHERE id = ?',
        [memberId],
        (err, result) => {
            if (err) {
                console.error('❌ Gagal mengubah status menjadi DITOLAK:', err);
                return res.status(500).json({ message: 'Gagal memperbarui status verifikasi' });
            }
            res.json({ message: 'Status berhasil diperbarui menjadi DITOLAK' });
        }
    );
});

router.put('/verifikasi/perpanjang/:id', (req, res) => {
    const memberId = req.params.id;
    const { masa_aktif } = req.body;

    db.query(
        'UPDATE members SET status_verifikasi = "PERPANJANG", masa_aktif = ? WHERE id = ?',
        [masa_aktif, memberId],
        (err, result) => {
            if (err) {
                console.error('❌ Gagal mengubah status menjadi PERPANJANG:', err);
                return res.status(500).json({ message: 'Gagal memperbarui status verifikasi' });
            }
            res.json({ message: 'Status berhasil diperbarui menjadi PERPANJANG', masa_aktif });
        }
    );
});

// **CHECK MASA AKTIF**
router.get('/check-masa-aktif', (req, res) => {
    const currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD

    db.query(
        'UPDATE members SET status_verifikasi = "PERPANJANG" WHERE masa_aktif < ? AND status_verifikasi IN ("DITERIMA", "DITOLAK")',
        [currentDate],
        (err, result) => {
            if (err) {
                console.error('❌ Gagal memeriksa masa aktif:', err);
                return res.status(500).json({ message: 'Gagal memeriksa masa aktif' });
            }
            res.json({ message: 'Pemeriksaan masa aktif selesai', updated: result.affectedRows });
        }
    );
});

// **UPDATE MASA AKTIF**
router.put('/update-masa-aktif/:id', (req, res) => {
    const memberId = req.params.id;
    const { masa_aktif } = req.body;

    db.query(
        'UPDATE members SET masa_aktif = ? WHERE id = ?',
        [masa_aktif, memberId],
        (err, result) => {
            if (err) {
                console.error('❌ Gagal mengupdate masa aktif:', err);
                return res.status(500).json({ message: 'Gagal mengupdate masa aktif' });
            }
            res.json({ message: 'Masa aktif berhasil diperbarui', masa_aktif });
        }
    );
});



module.exports = router;

// =========================================================
// =========================================================
// KEUANGAN AKUNTAN
// =========================================================

//Fungsi tambah
router.post('/keuangan/tambah', async (req, res) => {
    const { status, jumlah, deskripsi, tanggal } = req.body;

    // Validasi input
    if (!status || !jumlah || !deskripsi || !tanggal) {
        return res.status(400).json({ message: 'Semua data harus diisi!' });
    }

    try {
        // Simpan data ke database (saldo_akhir akan dihitung oleh trigger)
        db.query(
            'INSERT INTO admin_laporan_keuangan (status, jumlah, deskripsi, tanggal_waktu) VALUES (?, ?, ?, ?)',
            [status, jumlah, deskripsi, `${tanggal}T00:00:00`],
            (err) => {
                if (err) {
                    console.error('Gagal menambah transaksi:', err);
                    return res.status(500).json({ message: 'Gagal menambah transaksi' });
                }
                res.status(201).json({ message: 'Transaksi berhasil ditambahkan' });
            }
        );
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Gagal menambah transaksi' });
    }
});

// *🔹 Ambil Semua Data Keuangan*
router.get('/keuangan', (req, res) => {
    db.query('SELECT * FROM admin_laporan_keuangan ORDER BY tanggal_waktu DESC', (err, results) => {
        if (err) {
            console.error('❌ Gagal mengambil data keuangan:', err);
            return res.status(500).json({ message: 'Gagal mengambil data keuangan' });
        }
        res.json(results);
    });
});

// *🔹 Ambil Total Pendapatan Keseluruhan*
router.get('/keuangan/total-pendapatan', (req, res) => {
    db.query('SELECT SUM(jumlah) AS total FROM admin_laporan_keuangan WHERE status = "MASUK"', (err, results) => {
        if (err) {
            console.error('❌ Gagal mengambil total pendapatan:', err);
            return res.status(500).json({ message: 'Gagal mengambil total pendapatan' });
        }
        res.json({ total_pendapatan: results[0].total || 0 });
    });
});

//Fungsi untuk edit
router.put('/keuangan/edit/:id', async (req, res) => {
    const { id } = req.params;
    const { jumlah, deskripsi, tanggal } = req.body;

    // Validasi input
    if (!jumlah || !deskripsi || !tanggal) {
        return res.status(400).json({ message: 'Semua data harus diisi!' });
    }

    try {
        // Update transaksi
        await db.promise().query(
            'UPDATE admin_laporan_keuangan SET jumlah = ?, deskripsi = ?, tanggal_waktu = ? WHERE id = ?',
            [jumlah, deskripsi, `${tanggal}T00:00:00`, id]
        );

        // Panggil stored procedure untuk menghitung ulang saldo
        await db.promise().query('CALL RecalculateSaldo(?)', [id]);

        res.json({ message: 'Transaksi berhasil diupdate' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Gagal update transaksi' });
    }
});

//fungsi untuk delete keuangan
router.delete('/keuangan/delete/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Ambil ID transaksi yang akan dihapus
        const [existing] = await db.promise().query(
            'SELECT id FROM admin_laporan_keuangan WHERE id = ?',
            [id]
        );

        if (!existing.length) {
            return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
        }

        // Hapus transaksi
        await db.promise().query(
            'DELETE FROM admin_laporan_keuangan WHERE id = ?',
            [id]
        );

        // Panggil stored procedure untuk menghitung ulang saldo
        await db.promise().query('CALL RecalculateSaldo(?)', [existing[0].id]);

        res.json({ message: 'Transaksi berhasil dihapus' });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ message: 'Gagal menghapus transaksi' });
    }
});

// Fungsi untuk mengambil saldo terakhir
const getLastBalance = async () => {
    return new Promise((resolve, reject) => {
        db.query('SELECT saldo_akhir FROM admin_laporan_keuangan ORDER BY id DESC LIMIT 1', (err, results) => {
            if (err) {
                console.error('❌ Error mengambil saldo terakhir:', err);
                return reject(err);
            }
            resolve(results.length ? parseFloat(results[0].saldo_akhir) : 0);
        });
    });
};


// Fungsi untuk mengambil laporan bulan ini dari VIEW
const getLaporanBulanIni = async () => {
    return new Promise((resolve, reject) => {
        db.query('SELECT * FROM laporan_keuangan_bulan_ini', (err, results) => {
            if (err) {
                console.error('❌ Error mengambil laporan bulan ini:', err);
                return reject(err);
            }
            resolve(results[0]);
        });
    });
};

// *🔹 Ambil Laporan Bulan Ini*
router.get('/keuangan/bulan-ini', async (req, res) => {
    try {
        const currentDate = new Date();
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1; // Bulan dimulai dari 1

        // Query untuk pendapatan
        const [pendapatanResult] = await db.promise().query(
            `SELECT SUM(jumlah) AS total_pendapatan 
             FROM admin_laporan_keuangan 
             WHERE status = 'MASUK' 
               AND YEAR(tanggal_waktu) = ? 
               AND MONTH(tanggal_waktu) = ?`,
            [year, month]
        );

        // Query untuk pengeluaran
        const [pengeluaranResult] = await db.promise().query(
            `SELECT SUM(jumlah) AS total_pengeluaran 
             FROM admin_laporan_keuangan 
             WHERE status = 'KELUAR' 
               AND YEAR(tanggal_waktu) = ? 
               AND MONTH(tanggal_waktu) = ?`,
            [year, month]
        );

        res.json({
            total_pendapatan: pendapatanResult[0].total_pendapatan || 0,
            total_pengeluaran: pengeluaranResult[0].total_pengeluaran || 0
        });
    } catch (error) {
        console.error('Error mengambil laporan bulan ini:', error);
        res.status(500).json({ message: 'Gagal mengambil laporan bulan ini' });
    }
});


// Saldo Akhir
// Endpoint untuk mengambil saldo akhir
router.get('/keuangan/saldo-akhir', async (req, res) => {
    try {
        const [result] = await db.promise().query(
            'SELECT saldo_akhir FROM admin_laporan_keuangan ORDER BY id DESC LIMIT 1'
        );

        const saldoAkhir = result.length ? result[0].saldo_akhir : 0;
        res.json({ saldo_akhir: saldoAkhir });
    } catch (error) {
        console.error('❌ Gagal mengambil saldo akhir:', error);
        res.status(500).json({ message: 'Gagal mengambil saldo akhir' });
    }
});


// Endpoint untuk mencatat pendapatan dari perpanjang member
router.post('/keuangan/tambah-pendapatan-perpanjang', async (req, res) => {
    const { jumlah, deskripsi } = req.body;

    // Validasi input
    if (!jumlah || !deskripsi) {
        return res.status(400).json({ message: 'Jumlah dan deskripsi harus diisi!' });
    }

    try {
        // Simpan data ke database
        db.query(
            'INSERT INTO admin_laporan_keuangan (status, jumlah, deskripsi, tanggal_waktu) VALUES (?, ?, ?, ?)',
            ['MASUK', jumlah, deskripsi, new Date().toISOString()],
            (err) => {
                if (err) {
                    console.error('Gagal menambah pendapatan perpanjang:', err);
                    return res.status(500).json({ message: 'Gagal menambah pendapatan perpanjang' });
                }
                res.status(201).json({ message: 'Pendapatan perpanjang berhasil ditambahkan' });
            }
        );
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Gagal menambah pendapatan perpanjang' });
    }
});

// =================================================================
// TEMPAT BUAT PELATIHAN
// =================================================================
//D-4 ALL PELATIHAN
const uploadDir = path.join(__dirname, '../uploads/pelatihan');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const uploadStoragePelatihan = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    },
});

//D-7
const uploadPelatihan = multer({
    storage: uploadStoragePelatihan,
    fileFilter: (req, file, cb) => {
        const fileTypes = /jpeg|jpg|png/;
        const extName = fileTypes.test(path.extname(file.originalname).toLowerCase());
        const mimeType = fileTypes.test(file.mimetype);

        if (extName && mimeType) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diperbolehkan'));
        }
    }
});

// **GET Semua Data Pelatihan**
router.get('/pelatihan', (req, res) => {
    db.query('SELECT * FROM pelatihan_member', (err, results) => {
        if (err) {
            console.error('❌ Error mengambil data pelatihan:', err);
            return res.status(500).json({ message: 'Gagal mengambil data pelatihan' });
        }
        res.json(results);
    });
});

// **GET Pelatihan berdasarkan ID**
router.get('/pelatihan/:id', (req, res) => {
    const { id } = req.params;
    db.query('SELECT * FROM pelatihan_member WHERE id = ?', [id], (err, results) => {
        if (err) {
            console.error('❌ Error mengambil data pelatihan:', err);
            return res.status(500).json({ message: 'Gagal mengambil data pelatihan' });
        }
        if (results.length === 0) {
            return res.status(404).json({ message: 'Pelatihan tidak ditemukan' });
        }
        res.json(results[0]); // Kirim data sebagai object, bukan array
    });
});


// **POST Tambah Pelatihan Baru**
router.post('/pelatihan/tambah', uploadPelatihan.single('banner'), (req, res) => {
    const { judul_pelatihan, tanggal_pelatihan, tanggal_berakhir, deskripsi_pelatihan, link, narasumber, badge } = req.body;
    const banner = req.file ? `/uploads/pelatihan/${req.file.filename}` : null;

    // Generate kode otomatis jika tidak disediakan
    const kode = generateRandomCode(); // Buat fungsi ini atau gunakan library seperti shortid

    // Validasi semua field kecuali kode (karena bisa digenerate otomatis)
    if (!judul_pelatihan || !tanggal_pelatihan || !tanggal_berakhir || !deskripsi_pelatihan || !link || !narasumber || !banner || !badge) {
        return res.status(400).json({ message: 'Semua field harus diisi' });
    }

    // Query SQL tanpa field kode (jika tidak diperlukan)
    const sql = 'INSERT INTO pelatihan_member (judul_pelatihan, tanggal_pelatihan, tanggal_berakhir, deskripsi_pelatihan, link, narasumber, upload_banner, badge) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    db.query(sql, [judul_pelatihan, tanggal_pelatihan, tanggal_berakhir, deskripsi_pelatihan, link, narasumber, banner, badge], (err, result) => {
        if (err) {
            console.error('❌ Error menambahkan pelatihan:', err);
            return res.status(500).json({ message: 'Gagal menambahkan pelatihan' });
        }
        res.json({ message: 'Pelatihan berhasil ditambahkan', id: result.insertId });
    });
});

// Fungsi untuk generate kode acak
function generateRandomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// **PUT Edit Pelatihan** ===> D-7
router.put('/pelatihan/edit/:id', uploadPelatihan.single('upload_banner'), (req, res) => {
    const { id } = req.params;
    const { kode, judul_pelatihan, tanggal_pelatihan, tanggal_berakhir, deskripsi_pelatihan, link, narasumber, badge } = req.body;
    const banner = req.file ? `/uploads/pelatihan/${req.file.filename}` : null;

    // Validasi semua field termasuk kode
    if (!kode || !judul_pelatihan || !tanggal_pelatihan || !tanggal_berakhir || !deskripsi_pelatihan || !link || !narasumber || !badge) {
        return res.status(400).json({ message: 'Semua field harus diisi' });
    }

    // Konversi tanggal sebelum menyimpan ke database
    const tanggal_pelatihan_utc = moment.utc(req.body.tanggal_pelatihan).format("YYYY-MM-DD HH:mm:ss");
    const tanggal_berakhir_utc = moment.utc(req.body.tanggal_berakhir).format("YYYY-MM-DD HH:mm:ss");

    // Cek apakah ingin mengupdate banner
    let sql, values;
    if (banner) {
        sql = 'UPDATE pelatihan_member SET kode = ?, judul_pelatihan = ?, tanggal_pelatihan = ?, tanggal_berakhir = ?, deskripsi_pelatihan = ?, link = ?, narasumber = ?, badge = ?, upload_banner = ? WHERE id = ?';
        values = [kode, judul_pelatihan, tanggal_pelatihan_utc, tanggal_berakhir_utc, deskripsi_pelatihan, link, narasumber, badge, banner, id];

        // Hapus banner lama jika ada
        db.query('SELECT upload_banner FROM pelatihan_member WHERE id = ?', [id], (err, results) => {
            if (err) {
                console.error('❌ Error mendapatkan banner lama:', err);
                return res.status(500).json({ message: 'Gagal mengedit pelatihan' });
            }
            if (results.length > 0 && results[0].upload_banner) {
                const oldBannerPath = path.join(__dirname, '..', results[0].upload_banner);
                fs.unlink(oldBannerPath, (err) => {
                    if (err) console.error('⚠️ Gagal menghapus banner lama:', err);
                });
            }
        });
    } else {
        sql = 'UPDATE pelatihan_member SET kode = ?, judul_pelatihan = ?, tanggal_pelatihan = ?, tanggal_berakhir = ?, deskripsi_pelatihan = ?, link = ?, narasumber = ?, badge = ? WHERE id = ?';
        values = [kode, judul_pelatihan, tanggal_pelatihan, tanggal_berakhir, deskripsi_pelatihan, link, narasumber, badge, id];
    }

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error('❌ Error mengedit pelatihan:', err);
            return res.status(500).json({ message: 'Gagal mengedit pelatihan', error: err });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Pelatihan tidak ditemukan' });
        }
        res.json({ message: 'Pelatihan berhasil diperbarui' });
    });
});


// **DELETE Hapus Pelatihan**
router.delete('/pelatihan/delete/:id', (req, res) => {
    const { id } = req.params;

    // Cek apakah pelatihan ada dan ambil banner-nya
    db.query('SELECT upload_banner FROM pelatihan_member WHERE id = ?', [id], (err, results) => {
        if (err) {
            console.error('❌ Error mendapatkan data pelatihan:', err);
            return res.status(500).json({ message: 'Gagal menghapus pelatihan' });
        }
        if (results.length === 0) {
            return res.status(404).json({ message: 'Pelatihan tidak ditemukan' });
        }

        const bannerPath = results[0].upload_banner ? path.join(__dirname, '..', results[0].upload_banner) : null;

        // Hapus data pelatihan dari database
        db.query('DELETE FROM pelatihan_member WHERE id = ?', [id], (err, result) => {
            if (err) {
                console.error('❌ Error menghapus pelatihan:', err);
                return res.status(500).json({ message: 'Gagal menghapus pelatihan' });
            }

            if (result.affectedRows > 0 && bannerPath) {
                // Hapus file banner jika ada
                fs.unlink(bannerPath, (err) => {
                    if (err) console.error('⚠️ Gagal menghapus file banner:', err);
                });
            }

            res.json({ message: 'Pelatihan berhasil dihapus' });
        });
    });
});

//=======================================================
// Gallery / Foto (Modified to match Berita's approach)
//=======================================================

// Pastikan folder uploads/gallery ada
const galleryDir = path.join(__dirname, '../uploads/gallery');
if (!fs.existsSync(galleryDir)) {
    fs.mkdirSync(galleryDir, { recursive: true });
}

// Konfigurasi Multer untuk upload file
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, galleryDir); // Simpan file di folder uploads/gallery
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext); // Nama file: timestamp-random.ekstensi
    },
});

const upload = multer({ 
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diizinkan'), false);
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

// Helper untuk ekstrak nama file dari URL (untuk kompatibilitas dengan data lama)
const extractFilename = (url) => {
    if (!url) return null;
    return path.basename(url);
};

// **GET Semua Foto**
router.get('/gallery', (req, res) => {
    const sql = 'SELECT * FROM gallery ORDER BY created_at DESC';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Error mengambil data gallery:', err);
            return res.status(500).json({ message: 'Gagal mengambil data gallery' });
        }
        
        // Pastikan response hanya berisi nama file (untuk kompatibilitas)
        const modifiedResults = results.map(item => ({
            ...item,
            // Jika image_url sudah full URL, ekstrak nama file saja
            image_url: extractFilename(item.image_url)
        }));
        
        res.json(modifiedResults);
    });
});

// **POST Upload Multiple Foto**
router.post('/gallery/upload', upload.array('images', 5), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'Tidak ada file yang diunggah' });
    }

    const { keterangan } = req.body;

    // Simpan hanya nama file di database
    const imagesToSave = req.files.map(file => ({
        filename: file.filename,
        keterangan
    }));

    const sql = 'INSERT INTO gallery (image_url, keterangan_foto) VALUES ?';
    const values = imagesToSave.map(img => [img.filename, img.keterangan]);

    db.query(sql, [values], (err, result) => {
        if (err) {
            console.error('❌ Gagal mengunggah foto:', err);
            
            // Hapus file yang sudah terupload jika gagal
            req.files.forEach(file => {
                fs.unlink(path.join(galleryDir, file.filename), () => {});
            });
            
            return res.status(500).json({ message: 'Gagal mengunggah foto' });
        }

        res.status(201).json({
            message: 'Foto berhasil diunggah',
            data: imagesToSave.map((img, index) => ({
                id: result.insertId + index,
                image_url: img.filename, // Kembalikan hanya nama file
                keterangan_foto: img.keterangan
            }))
        });
    });
});

// **DELETE Hapus Foto**
router.delete('/gallery/delete/:id', (req, res) => {
    const { id } = req.params;

    // 1. Ambil data foto dari database
    db.query('SELECT image_url FROM gallery WHERE id = ?', [id], (err, results) => {
        if (err) {
            console.error('❌ Gagal mengambil data foto:', err);
            return res.status(500).json({ message: 'Gagal menghapus foto' });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: 'Foto tidak ditemukan' });
        }

        const imageUrl = results[0].image_url;
        const filename = extractFilename(imageUrl); // Dapatkan nama file saja

        // 2. Hapus file dari sistem
        fs.unlink(path.join(galleryDir, filename), (err) => {
            if (err && err.code !== 'ENOENT') { // Abaikan jika file tidak ditemukan
                console.error('❌ Gagal menghapus file:', err);
                return res.status(500).json({ message: 'Gagal menghapus file' });
            }

            // 3. Hapus dari database
            db.query('DELETE FROM gallery WHERE id = ?', [id], (err, result) => {
                if (err) {
                    console.error('❌ Gagal menghapus data foto:', err);
                    return res.status(500).json({ message: 'Gagal menghapus data foto' });
                }

                res.json({ message: 'Foto berhasil dihapus' });
            });
        });
    });
});
