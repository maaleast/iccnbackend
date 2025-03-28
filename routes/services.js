const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../db'); // Import koneksi database

// Konfigurasi penyimpanan file
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/services');
    // Buat direktori jika belum ada
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar yang diizinkan!'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// Helper function untuk validasi
const validateService = (service) => {
  if (!service.title || service.title.trim() === '') {
    return 'Judul layanan harus diisi';
  }
  if (!service.description || service.description.trim() === '') {
    return 'Deskripsi layanan harus diisi';
  }
  if (!service.date) {
    return 'Tanggal layanan harus diisi';
  }
  return null;
};

// Get all services - Perbaikan query
router.get('/all', async (req, res) => {
    try {
      const [services] = await db.promise().query(`
        SELECT 
          id,
          title,
          description,
          DATE_FORMAT(date, '%Y-%m-%d') as date,
          image,
          created_at,
          updated_at
        FROM services
        ORDER BY created_at DESC
      `);
      
      res.json({
        success: true,
        data: services
      });
    } catch (error) {
      console.error('Error fetching services:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data layanan'
      });
    }
  });

// Create new service - Sudah disesuaikan
router.post('/create', upload.single('image'), async (req, res) => {
    try {
      const { title, description, date } = req.body;
      
      const error = validateService({ title, description, date });
      if (error) {
        if (req.file) {
          fs.unlinkSync(path.join(__dirname, '../uploads/services', req.file.filename));
        }
        return res.status(400).json({
          success: false,
          message: error
        });
      }
  
      const [result] = await db.promise().query(
        `INSERT INTO services 
          (title, description, date, image) 
         VALUES (?, ?, ?, ?)`,
        [
          title, 
          description, 
          date, 
          req.file ? req.file.filename : null
        ]
      );
  
      const [newService] = await db.promise().query(
        `SELECT 
          id,
          title,
          description,
          DATE_FORMAT(date, '%Y-%m-%d') as date,
          image,
          created_at,
          updated_at
         FROM services 
         WHERE id = ?`,
        [result.insertId]
      );
  
      res.json({
        success: true,
        data: newService[0],
        message: 'Layanan berhasil ditambahkan'
      });
    } catch (error) {
      console.error('Error creating service:', error);
      if (req.file) {
        fs.unlinkSync(path.join(__dirname, '../uploads/services', req.file.filename));
      }
      res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan saat menambahkan layanan'
      });
    }
  });
  
  // Update service - Sudah disesuaikan
  router.put('/update/:id', upload.single('image'), async (req, res) => {
    try {
      const { id } = req.params;
      const { title, description, date } = req.body;
      
      const error = validateService({ title, description, date });
      if (error) {
        if (req.file) {
          fs.unlinkSync(path.join(__dirname, '../uploads/services', req.file.filename));
        }
        return res.status(400).json({
          success: false,
          message: error
        });
      }
  
      // Cek apakah layanan ada dan ambil data gambar lama
      const [existingService] = await db.promise().query(
        'SELECT image FROM services WHERE id = ?',
        [id]
      );
      
      if (existingService.length === 0) {
        if (req.file) {
          fs.unlinkSync(path.join(__dirname, '../uploads/services', req.file.filename));
        }
        return res.status(404).json({
          success: false,
          message: 'Layanan tidak ditemukan'
        });
      }
  
      // Hapus gambar lama jika ada gambar baru yang diupload
      if (req.file && existingService[0].image) {
        const oldImagePath = path.join(__dirname, '../uploads/services', existingService[0].image);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }
  
      // Update data di database
      await db.promise().query(
        `UPDATE services SET 
          title = ?,
          description = ?,
          date = ?,
          image = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          title,
          description,
          date,
          req.file ? req.file.filename : existingService[0].image,
          id
        ]
      );
  
      // Ambil data yang sudah diupdate
      const [updatedService] = await db.promise().query(
        `SELECT 
          id,
          title,
          description,
          DATE_FORMAT(date, '%Y-%m-%d') as date,
          image,
          created_at,
          updated_at
         FROM services 
         WHERE id = ?`,
        [id]
      );
  
      res.json({
        success: true,
        data: updatedService[0],
        message: 'Layanan berhasil diperbarui'
      });
    } catch (error) {
      console.error('Error updating service:', error);
      if (req.file) {
        fs.unlinkSync(path.join(__dirname, '../uploads/services', req.file.filename));
      }
      res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan saat memperbarui layanan'
      });
    }
  });

// Delete service - Perbaikan query
router.delete('/delete/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      // Ambil data gambar sebelum menghapus
      const [serviceToDelete] = await db.promise().query(
        'SELECT image FROM services WHERE id = ?', // Diubah dari image_url
        [id]
      );
      
      if (serviceToDelete.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Layanan tidak ditemukan'
        });
      }
  
      // Hapus gambar terkait jika ada
      if (serviceToDelete[0].image) { // Diubah dari image_url
        const imagePath = path.join(__dirname, '../uploads/services', serviceToDelete[0].image); // Diubah dari image_url
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      }
  
      // Hapus dari database
      await db.promise().query(
        'DELETE FROM services WHERE id = ?',
        [id]
      );
  
      res.json({
        success: true,
        message: 'Layanan berhasil dihapus'
      });
    } catch (error) {
      console.error('Error deleting service:', error);
      res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan saat menghapus layanan'
      });
    }
  });

// Get service image
router.get('/image/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const imagePath = path.join(__dirname, '../uploads/services', filename);
    
    if (fs.existsSync(imagePath)) {
      res.sendFile(imagePath);
    } else {
      res.status(404).json({
        success: false,
        message: 'Gambar tidak ditemukan'
      });
    }
  } catch (error) {
    console.error('Error getting service image:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan saat mengambil gambar layanan'
    });
  }
});

module.exports = router;