const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');

// Konfigurasi Multer untuk upload gambar
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/berita/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });
// ✅ GET: Semua berita dengan status yang sesuai
router.get('/all-berita', async (req, res) => {
    try {
        const query = 'SELECT * FROM berita ORDER BY created_at DESC';
        const [rows] = await db.promise().query(query);

        const updatedRows = rows.map((item) => {
            const now = new Date();
            const created_at = new Date(item.created_at);
            const waktu_tayang = new Date(item.waktu_tayang);

            // Jika status sudah di-set sebagai archived atau branding, pertahankan status tersebut
            if (item.status === 'archived' || item.status === 'branding') {
                return item;
            }

            // Tentukan status berdasarkan waktu_tayang dan created_at
            if (waktu_tayang > now) {
                item.status = 'upcoming';
            } else if (now - created_at < 7 * 24 * 60 * 60 * 1000) {
                item.status = 'latest';
            } else if (now - created_at > 30 * 24 * 60 * 60 * 1000) {
                item.status = 'archived';
            }

            return item;
        });

        res.json({ success: true, data: updatedRows });
    } catch (error) {
        console.error('Error fetching berita:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

// ✅ GET: Detail berita berdasarkan ID
router.get('/detail/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const query = 'SELECT * FROM berita WHERE id = ?';
        const [rows] = await db.promise().query(query, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Berita tidak ditemukan' });
        }

        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Error fetching berita detail:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

// ✅ POST: Tambah berita baru dengan gambar
router.post('/uploadberita', upload.single('gambar'), async (req, res) => {
    const { judul, deskripsi, waktu_tayang } = req.body;
    const gambar = req.file ? req.file.filename : null;

    if (!judul || !deskripsi || !waktu_tayang) {
        return res.status(400).json({ success: false, message: 'Judul, deskripsi, dan waktu tayang tidak boleh kosong' });
    }

    try {
        // Tentukan status berdasarkan waktu_tayang
        const now = new Date();
        const waktuTayang = new Date(waktu_tayang);
        const status = waktuTayang > now ? 'upcoming' : 'latest';

        const query = `INSERT INTO berita (judul, deskripsi, waktu_tayang, gambar, status, created_at, updated_at) 
                       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`;
        const [result] = await db.promise().execute(query, [judul, deskripsi, waktu_tayang, gambar, status]);

        res.json({ success: true, message: 'Berita berhasil ditambahkan', id: result.insertId });
    } catch (error) {
        console.error('Error adding berita:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

// ✅ PUT: Edit berita berdasarkan ID dengan gambar
router.put('/edit/:id', upload.single('gambar'), async (req, res) => {
    const { id } = req.params;
    const { judul, deskripsi, waktu_tayang, status, gambar_lama } = req.body;
    const gambar = req.file ? req.file.filename : gambar_lama;

    if (!judul || !deskripsi || !status) {
        return res.status(400).json({ success: false, message: 'Judul, deskripsi, dan status harus diisi' });
    }

    try {
        // Cek apakah ID berita ada di database
        const [cekBerita] = await db.promise().query('SELECT * FROM berita WHERE id = ?', [id]);

        if (cekBerita.length === 0) {
            return res.status(404).json({ success: false, message: 'Berita tidak ditemukan' });
        }

        // Gunakan waktu_tayang yang sudah ada jika tidak diubah
        const waktuTayang = waktu_tayang || cekBerita[0].waktu_tayang;

        const query = `UPDATE berita SET judul = ?, deskripsi = ?, waktu_tayang = ?, gambar = ?, status = ?, updated_at = NOW() 
                       WHERE id = ?`;
        const [result] = await db.promise().execute(query, [judul, deskripsi, waktuTayang, gambar, status, id]);

        res.json({ success: true, message: 'Berita berhasil diperbarui' });
    } catch (error) {
        console.error('Error updating berita:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

// ✅ DELETE: Hapus berita berdasarkan ID
router.delete('/hapus/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Cek apakah ID berita ada di database
        const [cekBerita] = await db.promise().query('SELECT id FROM berita WHERE id = ?', [id]);

        if (cekBerita.length === 0) {
            return res.status(404).json({ success: false, message: 'Berita tidak ditemukan' });
        }

        const query = 'DELETE FROM berita WHERE id = ?';
        await db.promise().execute(query, [id]);

        res.json({ success: true, message: 'Berita berhasil dihapus' });
    } catch (error) {
        console.error('Error deleting berita:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

// ✅ PUT: Arsipkan berita berdasarkan ID
router.put('/:id/archive', async (req, res) => {
    const { id } = req.params;

    try {
        // Ambil data berita dari database
        const [berita] = await db.promise().query('SELECT * FROM berita WHERE id = ?', [id]);

        if (berita.length === 0) {
            return res.status(404).json({ success: false, message: 'Berita tidak ditemukan' });
        }

        const now = new Date();
        const waktu_tayang = new Date(berita[0].waktu_tayang);

        // Cek apakah waktu_tayang sudah lewat
        if (waktu_tayang > now) {
            return res.status(400).json({ success: false, message: 'Berita yang belum melewati waktu tayang tidak boleh diarsipkan' });
        }

        // Update status menjadi archived
        const query = `UPDATE berita SET status = 'archived', updated_at = NOW() WHERE id = ?`;
        const [result] = await db.promise().execute(query, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Berita tidak ditemukan' });
        }

        res.json({ success: true, message: 'Berita berhasil diarsipkan' });
    } catch (error) {
        console.error('Error archiving berita:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

// ✅ PUT: Tandai berita sebagai branding berdasarkan ID
router.put('/:id/branding', async (req, res) => {
    const { id } = req.params;

    try {
        const query = `UPDATE berita SET status = 'branding', updated_at = NOW() WHERE id = ?`;
        const [result] = await db.promise().execute(query, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Berita tidak ditemukan' });
        }

        res.json({ success: true, message: 'Berita berhasil ditandai sebagai branding' });
    } catch (error) {
        console.error('Error marking berita as branding:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

// ✅ GET: Filter berita berdasarkan status
router.get('/filter-by-status', async (req, res) => {
    const { status } = req.query; // Ambil parameter status dari query string

    try {
        let query = 'SELECT * FROM berita';

        // Jika status diberikan, tambahkan kondisi WHERE
        if (status && status !== 'all') {
            query += ' WHERE status = ?';
        }

        query += ' ORDER BY created_at DESC'; // Urutkan berdasarkan created_at DESC

        // Eksekusi query dengan atau tanpa parameter status
        const [rows] = await db.promise().query(query, status && status !== 'all' ? [status] : []);

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error filtering berita by status:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

// ✅ PUT: Update status berita (arsipkan, batal arsip, branding, nonaktifkan branding)
router.put('/:id/update-status', async (req, res) => {
    const { id } = req.params;

    try {
        // Ambil data berita dari database
        const [berita] = await db.promise().query('SELECT * FROM berita WHERE id = ?', [id]);

        if (berita.length === 0) {
            return res.status(404).json({ success: false, message: 'Berita tidak ditemukan' });
        }

        const now = new Date();
        const waktu_tayang = new Date(berita[0].waktu_tayang);

        // Tentukan status baru berdasarkan status saat ini
        let newStatus;
        if (berita[0].status === 'archived') {
            // Jika status saat ini adalah archived, ubah ke latest atau upcoming
            newStatus = waktu_tayang <= now ? 'latest' : 'upcoming';
        } else if (berita[0].status === 'branding') {
            // Jika status saat ini adalah branding, ubah ke latest
            newStatus = 'latest';
        } else if (berita[0].status === 'latest' || berita[0].status === 'upcoming') {
            // Jika status saat ini adalah latest atau upcoming, ubah ke branding
            newStatus = 'branding';
        } else {
            return res.status(400).json({ success: false, message: 'Status tidak valid untuk diperbarui' });
        }

        // Update status di database
        const query = `UPDATE berita SET status = ?, updated_at = NOW() WHERE id = ?`;
        const [result] = await db.promise().execute(query, [newStatus, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Berita tidak ditemukan' });
        }

        res.json({ success: true, message: 'Status berita berhasil diperbarui', newStatus });
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

module.exports = router;