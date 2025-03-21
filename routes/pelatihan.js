const express = require('express');
const router = express.Router();
const db = require('../db');

// Endpoint untuk mendapatkan ID member berdasarkan user_id (Tanpa Authentication) untuk mendaftar pelatihan
router.get('/members/id/:user_id', async (req, res) => {
    const { user_id } = req.params;

    try {
        // Ambil data member termasuk no_identitas & badge
        const [results] = await db.promise().query(
            `SELECT id AS member_id, no_identitas, badge FROM members WHERE user_id = ?`, 
            [user_id]
        );

        if (results.length === 0) {
            return res.status(404).json({ message: "Member tidak ditemukan" });
        }

        const member = results[0];

        // Ambil 2 digit terakhir dari no_identitas
        const key = member.no_identitas.slice(-2);
        console.log("🔑 Key untuk filtering:", key);

        let filteredBadge = [];
        try {
            console.log("📜 Badge sebelum parsing:", member.badge);

            // Pastikan badge adalah string JSON sebelum diparsing
            const badgeObject = typeof member.badge === "string" ? JSON.parse(member.badge) : member.badge;
            console.log("🧐 Badge setelah parsing:", badgeObject);

            // Periksa apakah key ada dalam object
            if (badgeObject && typeof badgeObject === "object" && badgeObject[key]) {
                filteredBadge = Object.values(badgeObject[key]); // Ubah object jadi array
            }

            console.log("✅ Filtered Badge:", filteredBadge);
        } catch (error) {
            console.error("❌ Error parsing badge:", error);
        }

        res.json({
            member_id: member.member_id,
            no_identitas: member.no_identitas,
            badge: filteredBadge
        });
    } catch (error) {
        console.error("❌ Error mengambil data member:", error);
        res.status(500).json({ message: "Terjadi kesalahan pada server" });
    }
});

// 🔹 Endpoint untuk mendapatkan data pelatihan berdasarkan user_id (Tanpa Authentication)
router.get('/pelatihan-info/:member_id', async (req, res) => {
    const { member_id } = req.params;

    try {
        const [results] = await db.promise().query(
            `SELECT * FROM peserta_pelatihan WHERE member_id = ?`, 
            [member_id]
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
