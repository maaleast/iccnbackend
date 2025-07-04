const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure image storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, '../../uploads/events');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, 'event-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// GET all events
router.get('/all', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM events ORDER BY created_at DESC');
    res.status(200).json({ 
      success: true, 
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch events',
      error: error.message 
    });
  }
});

// CREATE event
router.post('/create', upload.single('image'), async (req, res) => {
  try {
    const { title, shortDescription, description, date } = req.body;
    
    if (!title || !description || !date) {
      return res.status(400).json({
        success: false,
        message: 'Judul, deskripsi, dan tanggal wajib diisi'
      });
    }

    const image = req.file ? req.file.filename : null;

    const result = await db.query(
      `INSERT INTO events 
       (judul, deskripsi_singkat, deskripsi, tanggal, gambar) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [title, shortDescription, description, date, image]
    );

    res.status(201).json({ 
      success: true, 
      data: result.rows[0],
      message: 'Event berhasil dibuat'
    });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal membuat event',
      error: error.message 
    });
  }
});

// UPDATE event
router.put('/update/:id', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, shortDescription, description, date, image_old } = req.body;
    
    if (!title || !description || !date) {
      return res.status(400).json({
        success: false,
        message: 'Judul, deskripsi, dan tanggal wajib diisi'
      });
    }

    let image = image_old;
    if (req.file) {
      image = req.file.filename;
      // Delete old image if exists
      if (image_old) {
        const oldImagePath = path.join(__dirname, '../../uploads/events', image_old);
        fs.unlink(oldImagePath, (err) => {
          if (err) console.error('Error deleting old image:', err);
        });
      }
    }

    const result = await db.query(
      `UPDATE events 
       SET judul = $1, 
           deskripsi_singkat = $2, 
           deskripsi = $3, 
           tanggal = $4, 
           gambar = $5, 
           updated_at = NOW() 
       WHERE id = $6 
       RETURNING *`,
      [title, shortDescription, description, date, image, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Event tidak ditemukan' 
      });
    }

    res.status(200).json({ 
      success: true, 
      data: result.rows[0],
      message: 'Event berhasil diperbarui'
    });
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal memperbarui event',
      error: error.message 
    });
  }
});

// DELETE event
router.delete('/delete/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get image data first
    const eventResult = await db.query('SELECT gambar FROM events WHERE id = $1', [id]);
    if (eventResult.rowCount === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Event tidak ditemukan' 
      });
    }

    // Delete image if exists
    const image = eventResult.rows[0].gambar;
    if (image) {
      const imagePath = path.join(__dirname, '../../uploads/events', image);
      fs.unlink(imagePath, (err) => {
        if (err) console.error('Error deleting image:', err);
      });
    }

    // Delete event from database
    const result = await db.query('DELETE FROM events WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Event tidak ditemukan' 
      });
    }

    res.status(200).json({ 
      success: true, 
      message: 'Event berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal menghapus event',
      error: error.message 
    });
  }
});

module.exports = router;