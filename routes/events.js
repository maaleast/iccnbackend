const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Setup upload directory (sama seperti di services.js)
const uploadDir = path.join(__dirname, '../uploads/');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Konfigurasi penyimpanan (sama seperti di services.js)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueName + path.extname(file.originalname));
  }
});

// Middleware multer (sama seperti di services.js)
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/jpg',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    allowedTypes.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file type'));
  }
});

// Helper function
const formatDate = (dateString) => {
  return dateString ? new Date(dateString).toISOString().split('T')[0] : null;
};

// GET ALL EVENTS
router.get('/all', async (req, res) => {
  try {
    const [events] = await db.promise().query('SELECT * FROM events ORDER BY created_at DESC');
    
    // Format response sama seperti di services.js
    res.json({ success: true, data: events });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data events' });
  }
});

router.post('/create', upload.fields([{ name: 'image' }, { name: 'document' }]), async (req, res) => {
  try {
    const { title, shortDescription, description, startDate, endDate } = req.body;

    if (!title || !description || !startDate) {
      [req.files?.image, req.files?.document].forEach(file => file && fs.unlinkSync(file[0].path));
      return res.status(400).json({ success: false, message: 'Required fields missing' });
    }

    // 🔥 Tambahkan ini
    const imageFile = req.files?.image?.[0]?.filename || null;
    const documentFile = req.files?.document?.[0]?.filename || null;

    const [result] = await db.promise().query(
      'INSERT INTO events (judul, deskripsi_singkat, deskripsi, tanggal, start_date, end_date, gambar, document) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [title, shortDescription || null, description, startDate, startDate, endDate || null, imageFile, documentFile]
    );

    res.status(201).json({
      success: true,
      message: 'Event berhasil dibuat',
      data: {
        id: result.insertId,
        judul: title,
        deskripsi_singkat: shortDescription || null,
        deskripsi: description,
        tanggal: formatDate(startDate),
        start_date: formatDate(startDate),
        end_date: formatDate(endDate || startDate),
        gambar: imageFile ? `http://${req.get('host')}/uploads/events/${imageFile}` : null,
        document: documentFile ? `http://${req.get('host')}/uploads/events/${documentFile}` : null
      }
    });

  } catch (error) {
    [req.files?.image, req.files?.document].forEach(file => file && fs.unlinkSync(file[0].path));
    console.error('Error creating event:', error);
    res.status(500).json({ success: false, message: 'Failed to create event', error: error.message });
  }
});


// GET SINGLE EVENT
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.promise().query('SELECT * FROM events WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Event tidak ditemukan' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data event' });
  }
});

// UPDATE EVENT
router.put('/update/:id', upload.fields([{ name: 'image' }, { name: 'document' }]), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, shortDescription, description, startDate, endDate, old_image, old_document } = req.body;

    if (!title || !description || !startDate) {
      return res.status(400).json({ success: false, message: 'Judul, deskripsi, dan tanggal mulai wajib diisi' });
    }

    const [existing] = await db.promise().query('SELECT * FROM events WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Event tidak ditemukan' });
    }

    let image = old_image;
    let document = old_document;

    // Handle image update
    if (req.files?.image?.[0]) {
      image = req.files.image[0].filename;
      if (old_image) {
        const oldPath = path.join(uploadDir, old_image);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }

    // Handle document update
    if (req.files?.document?.[0]) {
      document = req.files.document[0].filename;
      if (old_document) {
        const oldDocPath = path.join(uploadDir, old_document);
        if (fs.existsSync(oldDocPath)) fs.unlinkSync(oldDocPath);
      }
    }

    await db.promise().query(
      `UPDATE events SET 
        judul = ?, 
        deskripsi_singkat = ?, 
        deskripsi = ?, 
        start_date = ?,
        end_date = ?,
        gambar = ?, 
        document = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [title, shortDescription || null, description, startDate, endDate || startDate, image, document, id]
    );

    res.json({ 
      success: true, 
      message: 'Event berhasil diperbarui',
      data: {
        id,
        judul: title,
        deskripsi_singkat: shortDescription,
        deskripsi: description,
        start_date: startDate,
        end_date: endDate || startDate,
        gambar: image,
        document: document
      }
    });
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ success: false, message: 'Gagal memperbarui event' });
  }
});

// DELETE EVENT
router.delete('/delete/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [data] = await db.promise().query('SELECT * FROM events WHERE id = ?', [id]);
    if (data.length === 0) {
      return res.status(404).json({ success: false, message: 'Event tidak ditemukan' });
    }

    const { gambar, document } = data[0];
    if (gambar) {
      const imgPath = path.join(uploadDir, gambar);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    if (document) {
      const docPath = path.join(uploadDir, document);
      if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
    }

    await db.promise().query('DELETE FROM events WHERE id = ?', [id]);

    res.json({ success: true, message: 'Event berhasil dihapus' });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus event' });
  }
});

module.exports = router;