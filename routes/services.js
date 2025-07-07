const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');

// Buat folder uploads jika belum ada
const uploadDir = path.join(__dirname, '../uploads/');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Konfigurasi penyimpanan
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueName + path.extname(file.originalname));
    }
});

// Middleware multer
const upload = multer({ storage });

// GET semua service
router.get('/all', async (req, res) => {
    try {
        const [services] = await db.promise().query('SELECT * FROM services ORDER BY created_at DESC');
        res.json({ success: true, data: services });
    } catch (err) {
        console.error('🔥 ERROR GET ALL:', err);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

// GET service by id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.promise().query('SELECT * FROM services WHERE id = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Service tidak ditemukan' });
        }

        res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('🔥 ERROR GET BY ID:', err);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

// POST create service
router.post('/create', upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'document', maxCount: 1 }
]), async (req, res) => {
    try {
        const { title, description, date } = req.body;
        const image = req.files?.image?.[0]?.filename || null;
        const document = req.files?.document?.[0]?.filename || null;
        let konten = null;

        if (!title || !description || !date) {
            return res.status(400).json({ success: false, message: 'Field wajib tidak lengkap' });
        }

        if (document) {
            const docPath = path.join(uploadDir, document);
            const result = await mammoth.convertToHtml({ path: docPath });
            konten = result.value;
        }

        const [result] = await db.promise().query(
            'INSERT INTO services (title, description, date, image, document, konten, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [title, description, date, image, document, konten]
        );

        res.status(201).json({
            success: true,
            message: 'Service berhasil ditambahkan',
            data: { id: result.insertId, title, description, date, image, document }
        });
    } catch (err) {
        console.error('🔥 ERROR CREATE:', err);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
});

// PUT update service
router.put('/update/:id', upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'document', maxCount: 1 }
]), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, date, old_image, old_document } = req.body;

        if (!title || !description || !date) {
            return res.status(400).json({ success: false, message: 'Field wajib tidak lengkap' });
        }

        const [existing] = await db.promise().query('SELECT * FROM services WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
        }

        let image = old_image;
        let document = old_document;
        let konten = existing[0].konten;

        // Ganti gambar jika diupload
        if (req.files?.image?.[0]) {
            image = req.files.image[0].filename;
            if (old_image) {
                const oldPath = path.join(uploadDir, old_image);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
        }

        // Ganti dokumen jika diupload
        if (req.files?.document?.[0]) {
            document = req.files.document[0].filename;
            const docPath = path.join(uploadDir, document);
            const result = await mammoth.convertToHtml({ path: docPath });
            konten = result.value;
            if (old_document) {
                const oldDocPath = path.join(uploadDir, old_document);
                if (fs.existsSync(oldDocPath)) fs.unlinkSync(oldDocPath);
            }
        }

        await db.promise().query(
            'UPDATE services SET title=?, description=?, date=?, image=?, document=?, konten=?, updated_at=NOW() WHERE id=?',
            [title, description, date, image, document, konten, id]
        );

        res.json({ success: true, message: 'Service berhasil diperbarui' });
    } catch (err) {
        console.error('🔥 ERROR UPDATE:', err);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan saat update', error: err.message });
    }
});

// DELETE service
router.delete('/delete/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [data] = await db.promise().query('SELECT * FROM services WHERE id = ?', [id]);
        if (data.length === 0) {
            return res.status(404).json({ success: false, message: 'Service tidak ditemukan' });
        }

        const { image, document } = data[0];
        if (image) {
            const imgPath = path.join(uploadDir, image);
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        }
        if (document) {
            const docPath = path.join(uploadDir, document);
            if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
        }

        await db.promise().query('DELETE FROM services WHERE id = ?', [id]);

        res.json({ success: true, message: 'Service berhasil dihapus' });
    } catch (err) {
        console.error('🔥 ERROR DELETE:', err);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan saat menghapus' });
    }
});

module.exports = router;