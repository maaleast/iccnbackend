const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');

// Buat folder uploads/berita/dokumen jika belum ada
const uploadDir = path.join(__dirname, '../uploads/berita/dokumen');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Konfigurasi Multer untuk upload gambar dan dokumen
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (file.fieldname === 'gambar') {
            cb(null, 'uploads/berita/'); // Simpan gambar di uploads/berita/
        } else if (file.fieldname === 'dokumen') {
            cb(null, 'uploads/berita/dokumen/'); // Simpan dokumen di uploads/berita/dokumen/
        }
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname)); // Nama file unik
    }
});

// ✅ GET: Filter berita berdasarkan status
router.get('/filter-by-status', async (req, res) => {
    const { status } = req.query;

    try {
        let query = 'SELECT * FROM berita';
        let params = [];

        // Jika status tidak 'all', tambahkan filter ke query
        if (status && status !== 'all') {
            query += ' WHERE status = ?';
            params.push(status);
        }

        // Eksekusi query
        const [rows] = await db.promise().query(query, params);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Tidak ada berita yang ditemukan' });
        }

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching filtered berita:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

const fileFilter = (req, file, cb) => {
    if (file.fieldname === 'gambar') {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diizinkan'), false);
        }
    } else if (file.fieldname === 'dokumen') {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            cb(null, true);
        } else {
            cb(new Error('Hanya file DOCX yang diizinkan'), false);
        }
    } else {
        cb(new Error('Field tidak valid'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

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

// ✅ POST: Tambah berita baru dengan gambar dan dokumen
router.post('/uploadberita', upload.fields([{ name: 'gambar' }, { name: 'dokumen' }]), async (req, res) => {
    const { judul, deskripsi, waktu_tayang } = req.body;
    const gambar = req.files['gambar'] ? req.files['gambar'][0].filename : null;
    const dokumen = req.files['dokumen'] ? req.files['dokumen'][0].filename : null;

    if (!judul || !deskripsi || !waktu_tayang) {
        return res.status(400).json({ success: false, message: 'Judul, deskripsi, dan waktu tayang tidak boleh kosong' });
    }

    try {
        // Tentukan status berdasarkan waktu_tayang
        const now = new Date();
        const waktuTayang = new Date(waktu_tayang);
        const status = waktuTayang > now ? 'upcoming' : 'latest';

        const query = `INSERT INTO berita (judul, deskripsi, waktu_tayang, gambar, dokumen, status, created_at, updated_at) 
                       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`;
        const [result] = await db.promise().execute(query, [judul, deskripsi, waktu_tayang, gambar, dokumen, status]);

        res.json({ success: true, message: 'Berita berhasil ditambahkan', id: result.insertId });
    } catch (error) {
        console.error('Error adding berita:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

// ✅ PUT: Edit berita berdasarkan ID dengan gambar dan dokumen
router.put('/edit/:id', upload.fields([{ name: 'gambar' }, { name: 'dokumen' }]), async (req, res) => {
    const { id } = req.params;
    const { judul, deskripsi, waktu_tayang, status, gambar_lama, dokumen_lama } = req.body;
    const gambar = req.files['gambar'] ? req.files['gambar'][0].filename : gambar_lama;
    const dokumen = req.files['dokumen'] ? req.files['dokumen'][0].filename : dokumen_lama;

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

        const query = `UPDATE berita SET judul = ?, deskripsi = ?, waktu_tayang = ?, gambar = ?, dokumen = ?, status = ?, updated_at = NOW() 
                       WHERE id = ?`;
        const [result] = await db.promise().execute(query, [judul, deskripsi, waktuTayang, gambar, dokumen, status, id]);

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

// ✅ GET: Konversi dokumen ke HTML
router.get('/dokumen/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(__dirname, '../uploads/berita/dokumen', filename); // Sesuaikan path
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('Dokumen tidak ditemukan');
        }

        const result = await mammoth.convertToHtml({ path: filePath });
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Preview Dokumen</title>
                <style>
                    body { max-width: 8.5in; margin: 0 auto; padding: 20px; }
                    img { max-width: 100%; }
                    table { border-collapse: collapse; }
                    td, th { border: 1px solid #ddd; padding: 8px; }
                </style>
            </head>
            <body>
                ${result.value}
            </body>
            </html>
        `;

        res.send(html);
    } catch (error) {
        console.error('Error converting DOCX:', error);
        res.status(500).send('Gagal mengonversi dokumen');
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
        // Ambil data berita dari database
        const [berita] = await db.promise().query('SELECT * FROM berita WHERE id = ?', [id]);

        if (berita.length === 0) {
            return res.status(404).json({ success: false, message: 'Berita tidak ditemukan' });
        }

        // Update status menjadi branding
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

// ✅ PUT: Update status berita (arsipkan, batal arsip, branding, nonaktifkan branding)
router.put('/:id/update-status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        // Ambil data berita dari database
        const [berita] = await db.promise().query('SELECT * FROM berita WHERE id = ?', [id]);

        if (berita.length === 0) {
            return res.status(404).json({ success: false, message: 'Berita tidak ditemukan' });
        }

        // Validasi status yang diizinkan
        const allowedStatuses = ['latest', 'upcoming', 'archived', 'branding'];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: 'Status tidak valid' });
        }

        // Update status di database
        const query = `UPDATE berita SET status = ?, updated_at = NOW() WHERE id = ?`;
        const [result] = await db.promise().execute(query, [status, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Berita tidak ditemukan' });
        }

        res.json({ success: true, message: 'Status berita berhasil diperbarui', newStatus: status });
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

module.exports = router;