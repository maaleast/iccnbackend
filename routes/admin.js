const express = require('express');
const router = express.Router();
const mysql = require('mysql2');
require('dotenv').config();


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


// **🔹 Tambah Pemasukan/Pengeluaran**
router.post('/keuangan/tambah', async (req, res) => {
    const { status, jumlah, deskripsi } = req.body;

    if (!status || !jumlah || !deskripsi) {
        return res.status(400).json({ message: 'Semua data harus diisi!' });
    }

    try {
        let saldoTerakhir = await getLastBalance();
        let saldoBaru = status === 'MASUK' 
            ? saldoTerakhir + parseFloat(jumlah) 
            : saldoTerakhir - parseFloat(jumlah);

        db.query(
            'INSERT INTO admin_laporan_keuangan (status, jumlah, deskripsi, saldo_akhir) VALUES (?, ?, ?, ?)',
            [status, jumlah, deskripsi, saldoBaru],
            (err) => {
                if (err) {
                    console.error('❌ Gagal menambah transaksi:', err);
                    return res.status(500).json({ message: 'Gagal menambah transaksi' });
                }
                res.status(201).json({ message: 'Transaksi berhasil ditambahkan', saldo_akhir: saldoBaru });
            }
        );
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ message: 'Gagal mengambil saldo terakhir' });
    }
});

// **🔹 Ambil Semua Data Keuangan**
router.get('/keuangan', (req, res) => {
    db.query('SELECT * FROM admin_laporan_keuangan ORDER BY tanggal_waktu DESC', (err, results) => {
        if (err) {
            console.error('❌ Gagal mengambil data keuangan:', err);
            return res.status(500).json({ message: 'Gagal mengambil data keuangan' });
        }
        res.json(results);
    });
});

// **🔹 Ambil Total Pendapatan Keseluruhan**
router.get('/keuangan/total-pendapatan', (req, res) => {
    db.query('SELECT SUM(jumlah) AS total FROM admin_laporan_keuangan WHERE status = "MASUK"', (err, results) => {
        if (err) {
            console.error('❌ Gagal mengambil total pendapatan:', err);
            return res.status(500).json({ message: 'Gagal mengambil total pendapatan' });
        }
        res.json({ total_pendapatan: results[0].total || 0 });
    });
});



// **🔹 Edit Transaksi**
router.put('/keuangan/edit/:id', async (req, res) => {
    const { id } = req.params;
    const { jumlah, deskripsi } = req.body;

    try {
        // Dapatkan transaksi yang akan diupdate
        const [existing] = await db.promise().query(
            'SELECT * FROM admin_laporan_keuangan WHERE id = ?', 
            [id]
        );
        
        if (!existing.length) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
        
        // Hitung ulang saldo
        const saldoTerakhir = await getLastBalance();
        const saldoBaru = existing[0].status === 'MASUK' 
            ? saldoTerakhir - existing[0].jumlah + parseFloat(jumlah)
            : saldoTerakhir + existing[0].jumlah - parseFloat(jumlah);

        // Update transaksi
        await db.promise().query(
            'UPDATE admin_laporan_keuangan SET jumlah = ?, deskripsi = ?, saldo_akhir = ? WHERE id = ?',
            [jumlah, deskripsi, saldoBaru, id]
        );
        
        res.json({ message: 'Transaksi updated', saldo_akhir: saldoBaru });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ message: 'Gagal update transaksi' });
    }
});

// **🔹 Hapus Transaksi**
router.delete('/keuangan/delete/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Dapatkan transaksi yang akan dihapus
        const [existing] = await db.promise().query(
            'SELECT * FROM admin_laporan_keuangan WHERE id = ?', 
            [id]
        );
        
        if (!existing.length) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
        
        // Hitung ulang saldo
        const saldoTerakhir = await getLastBalance();
        const saldoBaru = existing[0].status === 'MASUK' 
            ? saldoTerakhir - existing[0].jumlah
            : saldoTerakhir + existing[0].jumlah;

        // Hapus transaksi
        await db.promise().query(
            'DELETE FROM admin_laporan_keuangan WHERE id = ?',
            [id]
        );
        
        res.json({ message: 'Transaksi deleted', saldo_akhir: saldoBaru });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ message: 'Gagal hapus transaksi' });
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

router.get('/keuangan/bulan-ini', async (req, res) => {
    try {
        const laporanBulanIni = await getLaporanBulanIni();
        res.json(laporanBulanIni);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil laporan bulan ini' });
    }
});


// Saldo Akhir
router.get('/keuangan/saldo-akhir', async (req, res) => {
    try {
        const saldoTerakhir = await getLastBalance();
        res.json({ saldo_akhir: saldoTerakhir });
    } catch (error) {
        console.error('❌ Gagal mengambil saldo akhir:', error);
        res.status(500).json({ message: 'Gagal mengambil saldo akhir' });
    }
});


// =================================================================
// TEMPAT BUAT PELATIHAN


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

// **POST Tambah Pelatihan Baru**
router.post('/pelatihan/tambah', (req, res) => {
    const { judul_pelatihan, tanggal_pelatihan, tanggal_berakhir, deskripsi_pelatihan, link } = req.body;
    if (!judul_pelatihan || !tanggal_pelatihan || !tanggal_berakhir || !deskripsi_pelatihan || !link) {
        return res.status(400).json({ message: 'Semua field harus diisi' });
    }

    const sql = 'INSERT INTO pelatihan_member (judul_pelatihan, tanggal_pelatihan, tanggal_berakhir, deskripsi_pelatihan, link) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [judul_pelatihan, tanggal_pelatihan, tanggal_berakhir, deskripsi_pelatihan, link], (err, result) => {
        if (err) {
            console.error('❌ Error menambahkan pelatihan:', err);
            return res.status(500).json({ message: 'Gagal menambahkan pelatihan' });
        }
        res.json({ message: 'Pelatihan berhasil ditambahkan', id: result.insertId });
    });
});

// **PUT Edit Pelatihan**
router.put('/pelatihan/edit/:id', (req, res) => {
    const { id } = req.params;
    const { judul_pelatihan, tanggal_pelatihan, tanggal_berakhir, deskripsi_pelatihan, link } = req.body;

    if (!judul_pelatihan || !tanggal_pelatihan || !tanggal_berakhir || !deskripsi_pelatihan || !link) {
        return res.status(400).json({ message: 'Semua field harus diisi' });
    }

    const sql = 'UPDATE pelatihan_member SET judul_pelatihan = ?, tanggal_pelatihan = ?, tanggal_berakhir = ?, deskripsi_pelatihan = ?, link = ? WHERE id = ?';
    db.query(sql, [judul_pelatihan, tanggal_pelatihan, tanggal_berakhir, deskripsi_pelatihan, link, id], (err, result) => {
        if (err) {
            console.error('❌ Error mengedit pelatihan:', err);
            return res.status(500).json({ message: 'Gagal mengedit pelatihan' });
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
    const sql = 'DELETE FROM pelatihan_member WHERE id = ?';

    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error('❌ Error menghapus pelatihan:', err);
            return res.status(500).json({ message: 'Gagal menghapus pelatihan' });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Pelatihan tidak ditemukan' });
        }
        res.json({ message: 'Pelatihan berhasil dihapus' });
    });
});