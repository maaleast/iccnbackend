const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db'); // Import koneksi database

const router = express.Router();

// Fungsi untuk menentukan folder penyimpanan
const getDestination = (folder) => (req, file, cb) => {
    const dir = path.join('uploads/organisasi', folder).replace(/\\/g, '/');
    fs.mkdirSync(dir, { recursive: true }); // Buat folder jika belum ada
    cb(null, dir); // Simpan file di folder yang sesuai
};

// Konfigurasi Multer untuk setiap jenis
const uploadStruktur = multer({
    storage: multer.diskStorage({
        destination: getDestination('struktur'),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            const filename = `${Date.now()}${ext}`;
            cb(null, filename);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // Batas ukuran file 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diperbolehkan'));
        }
    }
});

const uploadBadanPengawas = multer({
    storage: multer.diskStorage({
        destination: getDestination('badanpengawas'),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            const filename = `${Date.now()}${ext}`;
            cb(null, filename);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // Batas ukuran file 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diperbolehkan'));
        }
    }
});

const uploadDirektorat = multer({
    storage: multer.diskStorage({
        destination: getDestination('direktorat'),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            const filename = `${Date.now()}${ext}`;
            cb(null, filename);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // Batas ukuran file 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diperbolehkan'));
        }
    }
});

// Endpoint untuk mendapatkan semua data organisasi
router.get('/', (req, res) => {
    const { position, role } = req.query;
    let query = `
        SELECT *, COALESCE(role, '') as role 
        FROM struktur_organisasi
        WHERE 1=1
    `;

    const params = [];
    if (position) {
        query += ' AND position = ?';
        params.push(position);
    }
    if (role !== undefined) {
        query += ' AND role = ?';
        params.push(role);
    }

    query += ` ORDER BY 
        FIELD(jenis, 'struktur', 'badanpengawas', 'direktorat'),
        FIELD(position, 'Presiden','Wakil Presiden','Sekretaris Jendral') DESC`;

    db.query(query, params, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });

        const dataWithPhotoUrl = results.map(item => ({
            ...item,
            photo_url: item.photo_url ? 
                `${req.protocol}://${req.get('host')}/${item.photo_url}` : 
                null
        }));

        res.json({ success: true, data: dataWithPhotoUrl });
    });
});

// Endpoint untuk menambah data organisasi
router.post('/', (req, res) => {
    const { jenis } = req.body;

    let uploadMiddleware;
    switch (jenis) {
        case 'badanpengawas':
            uploadMiddleware = uploadBadanPengawas.single('photo');
            break;
        case 'direktorat':
            uploadMiddleware = uploadDirektorat.single('photo');
            break;
        default:
            uploadMiddleware = uploadStruktur.single('photo');
    }

    uploadMiddleware(req, res, (err) => {
        if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }

        const { jenis, position, name, affiliation, sub_position, direktorat_name, role } = req.body;
        const photo_url = req.file ? req.file.path : null;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Nama wajib diisi' });
        }

        const query = `
            INSERT INTO struktur_organisasi (jenis, position, name, affiliation, sub_position, direktorat_name, role, photo_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(query, [jenis, position, name, affiliation, sub_position, direktorat_name, role, photo_url], (err, results) => {
            if (err) {
                return res.status(500).json({ success: false, message: err.message });
            }

            res.json({ success: true, data: { id: results.insertId, ...req.body, photo_url } });
        });
    });
});

// Endpoint untuk upload foto
router.post('/upload-photo/:id', (req, res) => {
    const { id } = req.params;

    const checkQuery = 'SELECT * FROM struktur_organisasi WHERE id = ?';
    db.query(checkQuery, [id], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

        const jenis = results[0].jenis;

        let uploadMiddleware;
        switch (jenis) {
            case 'badanpengawas':
                uploadMiddleware = uploadBadanPengawas.single('photo');
                break;
            case 'direktorat':
                uploadMiddleware = uploadDirektorat.single('photo');
                break;
            default:
                uploadMiddleware = uploadStruktur.single('photo');
        }

        uploadMiddleware(req, res, (err) => {
            if (err) {
                return res.status(400).json({ success: false, message: err.message });
            }

            if (!req.file) {
                return res.status(400).json({ success: false, message: 'File gambar wajib diisi' });
            }

            // Hapus foto lama jika ada
            const oldPhotoUrl = results[0].photo_url;
            if (oldPhotoUrl && fs.existsSync(oldPhotoUrl)) {
                fs.unlinkSync(oldPhotoUrl);
            }

            // Simpan path foto baru
            const photo_url = req.file.path;

            // Update database dengan foto baru
            const updateQuery = 'UPDATE struktur_organisasi SET photo_url = ? WHERE id = ?';
            db.query(updateQuery, [photo_url, id], (err, results) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, message: 'Foto berhasil diupload', photo_url });
            });
        });
    });
});

// Endpoint untuk mengedit data
router.put('/edit/:id', (req, res) => {
    const { id } = req.params;

    const checkQuery = 'SELECT * FROM struktur_organisasi WHERE id = ?';
    db.query(checkQuery, [id], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

        const jenis = results[0].jenis;

        let uploadMiddleware;
        switch (jenis) {
            case 'badanpengawas':
                uploadMiddleware = uploadBadanPengawas.single('photo');
                break;
            case 'direktorat':
                uploadMiddleware = uploadDirektorat.single('photo');
                break;
            default:
                uploadMiddleware = uploadStruktur.single('photo');
        }

        uploadMiddleware(req, res, (err) => {
            if (err) {
                return res.status(400).json({ success: false, message: err.message });
            }

            const { name, affiliation, position, jenis } = req.body;
            const photo_url = req.file ? req.file.path : null;

            // Validasi minimal ada satu field yang diupdate
            if (!name && !affiliation && !position && !photo_url) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Minimal salah satu field (name, affiliation, position, atau photo) harus diisi' 
                });
            }

            // Hapus foto lama jika ada
            const oldPhotoUrl = results[0].photo_url;
            if (photo_url && oldPhotoUrl && fs.existsSync(oldPhotoUrl)) {
                fs.unlinkSync(oldPhotoUrl);
            }

            // Update data
            const updates = {};
            if (name) updates.name = name;
            if (affiliation) updates.affiliation = affiliation;
            if (position) updates.position = position;
            if (photo_url) updates.photo_url = photo_url;
            if (jenis) updates.jenis = jenis;

            const updateQuery = 'UPDATE struktur_organisasi SET ? WHERE id = ?';
            db.query(updateQuery, [updates, id], (err, results) => {
                if (err) {
                    return res.status(500).json({ success: false, message: err.message });
                }

                res.json({ 
                    success: true, 
                    message: 'Update berhasil',
                    data: { id, ...updates }
                });
            });
        });
    });
});

// Endpoint untuk menghapus data
router.delete('/:id', (req, res) => {
    const { id } = req.params;

    // Cek apakah data dengan ID tersebut ada di database
    const checkQuery = 'SELECT * FROM struktur_organisasi WHERE id = ?';
    db.query(checkQuery, [id], (err, results) => {
        if (err) {
            return res.status(500).json({ success: false, message: err.message });
        }

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
        }

        // Hapus foto jika ada
        const photo_url = results[0].photo_url;
        if (photo_url && fs.existsSync(photo_url)) {
            fs.unlinkSync(photo_url);
        }

        // Hapus data dari database
        const deleteQuery = 'DELETE FROM struktur_organisasi WHERE id = ?';
        db.query(deleteQuery, [id], (err, results) => {
            if (err) {
                return res.status(500).json({ success: false, message: err.message });
            }

            res.json({ success: true, message: 'Data berhasil dihapus' });
        });
    });
});

module.exports = router;