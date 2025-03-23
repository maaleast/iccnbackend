const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db'); // Import koneksi database

const router = express.Router();

// Fungsi untuk menentukan folder penyimpanan
const getDestination = (req, file, cb) => {
  const jenis = req.body.jenis ? req.body.jenis.toLowerCase() : null;
  const position = req.body.position;

  let folder = 'struktur'; // Folder default

  // Tentukan folder berdasarkan jenis atau position
  if (jenis === 'badanpengawas') {
      folder = 'badanpengawas';
  } else if (jenis === 'direktorat') {
      folder = 'direktorat';
  } else if (position) {
      switch (position) {
          case 'Presiden':
              folder = 'presiden';
              break;
          case 'Wakil Presiden':
              folder = 'wapres';
              break;
          case 'Sekretaris Jendral':
              folder = 'sekjen';
              break;
          case 'Bendahara Umum':
              folder = 'bendahara';
              break;
          case 'Wakil Bendahara Umum':
              folder = 'wabenda';
              break;
          case 'Wakil Sekretaris Jendral':
              folder = 'wasekjen';
              break;
          default:
              folder = 'struktur'; // Folder default jika position tidak valid
      }
  }

  // Buat folder jika belum ada
  const dir = path.join('uploads/organisasi', folder).replace(/\\/g, '/'); // Ganti backslash dengan forward slash
  fs.mkdirSync(dir, { recursive: true });

  // Kembalikan folder tujuan
  cb(null, dir);
};

// Konfigurasi Multer untuk upload file
const storage = multer.diskStorage({
  destination: getDestination,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}${ext}`;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
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
router.post('/', upload.single('photo'), (req, res) => {
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

// Endpoint untuk menambah data organisasi
router.post('/direktorat', upload.single('photo'), (req, res) => {
  const { name, affiliation, position } = req.body; // Tambahkan field position jika diperlukan
  const photo_url = req.file ? req.file.path : null;

  if (!name || !affiliation || !position) {
      return res.status(400).json({ success: false, message: 'Nama, afiliasi, dan posisi wajib diisi' });
  }

  const query = `
      INSERT INTO direktorat (name, affiliation, photo_url, position)
      VALUES (?, ?, ?, ?)
  `;

  db.query(query, [name, affiliation, photo_url, position], (err, results) => {
      if (err) {
          return res.status(500).json({ success: false, message: err.message });
      }

      res.json({ success: true, data: { id: results.insertId, name, affiliation, photo_url, position } });
  });
});

// Endpoint untuk upload foto
router.post('/upload-photo/:id', upload.single('photo'), (req, res) => {
    const { id } = req.params;

    // Pastikan file gambar dikirim
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'File gambar wajib diisi' });
    }

    // Pastikan position dikirim
    if (!req.body.position) {
        return res.status(400).json({ success: false, message: 'Posisi wajib diisi' });
    }

    // Cek apakah data dengan ID tersebut ada di database
    const checkQuery = 'SELECT * FROM struktur_organisasi WHERE id = ?';
    db.query(checkQuery, [id], (err, results) => {
        if (err) {
            return res.status(500).json({ success: false, message: err.message });
        }

        if (results.length === 0) {
            return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
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
            if (err) {
                return res.status(500).json({ success: false, message: err.message });
            }

            res.json({ success: true, message: 'Foto berhasil diupload', photo_url });
        });
    });
});

// Endpoint untuk mengedit data
router.put('/edit/:id', upload.single('photo'), (req, res) => {
  const { id } = req.params;
  const { name, affiliation, position } = req.body;
  const photo_url = req.file ? req.file.path : null;

  // Validasi minimal ada satu field yang diupdate
  if (!name && !affiliation && !position && !photo_url) {
      return res.status(400).json({ 
          success: false, 
          message: 'Minimal salah satu field (name, affiliation, position, atau photo) harus diisi' 
      });
  }

  // Update data
  const updates = {};
  if (name) updates.name = name;
  if (affiliation) updates.affiliation = affiliation;
  if (position) updates.position = position;
  if (photo_url) updates.photo_url = photo_url;

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

// Endpoint untuk menghapus data
router.delete('/:id', (req, res) => {r
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