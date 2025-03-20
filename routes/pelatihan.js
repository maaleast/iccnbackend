const express = require('express');
const router = express.Router();
const db = require('../db'); // Koneksi database mysql2

// 🔹 Endpoint untuk mendapatkan data pelatihan berdasarkan user_id (Tanpa Authentication)
router.get('/pelatihan-info/:user_id', async (req, res) => {
    const { user_id } = req.params;

    try {
        const [results] = await db.promise().query(
            `SELECT * FROM pelatihan WHERE user_id = ?`, 
            [user_id]
        );

        if (results.length === 0) {
            return res.status(404).json({ message: "Data pelatihan tidak ditemukan" });
        }

        res.json(results);
    } catch (error) {
        console.error("❌ Error mengambil data pelatihan:", error);
        res.status(500).json({ message: "Terjadi kesalahan pada server" });
    }
});

module.exports = router;
