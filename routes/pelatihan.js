const express = require('express');
const router = express.Router();
const db = require('../db');
const db2 = require('../dbPool');
const knex = require("../dbKnex");

// Fungsi transformasi dan pembuatan kode unik
const transformIdentitas = (noIdentitas) => {
    if (!noIdentitas) {
        throw new Error('noIdentitas tidak terdefinisi');
    }
    return noIdentitas
        .split('')
        .map(char => String.fromCharCode(char.charCodeAt(0) + 1))
        .join('');
};

const generateRandomChars = (length) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

const shuffleString = (str) => {
    const array = str.split('');
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array.join('');
};

const transformToRandomChars = (str) => {
    return str
        .split('')
        .map(char => String.fromCharCode(char.charCodeAt(0) + 2))
        .join('');
};

const isKodeUnique = async (kode) => {
    const [results] = await db2.query('SELECT * FROM peserta_pelatihan WHERE kode = ?', [kode]);
    return results.length === 0; // True jika kode unik
};

// enspoint untuk mendaftar pelatihan
router.post('/mendaftar-pelatihan', async (req, res) => {
    const { pelatihan_id, member_id } = req.body;
    const connection = await db2.getConnection();

    if (!pelatihan_id || !member_id) {
        return res.status(400).json({ message: 'pelatihan_id dan member_id harus diisi' });
    }

    try {
        await connection.beginTransaction();

        // 1. Cek apakah pelatihan ada dan member ada
        const [pelatihanResults, memberResults] = await Promise.all([
            connection.query('SELECT * FROM pelatihan_member WHERE id = ?', [pelatihan_id]),
            connection.query('SELECT no_identitas, badge FROM members WHERE id = ?', [member_id])
        ]);

        if (pelatihanResults.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: `Pelatihan dengan ID ${pelatihan_id} tidak ditemukan` });
        }

        if (memberResults.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: `Member dengan ID ${member_id} tidak ditemukan` });
        }

        const pelatihan = pelatihanResults[0][0];
        const member = memberResults[0][0]; // Ambil elemen pertama dari array
        console.log('member:', member); // Debugging

        const noIdentitas = member.no_identitas;
        console.log('noIdentitas:', noIdentitas); // Debugging

        // 2. Cek apakah member sudah mendaftar ke pelatihan ini
        const [pesertaResults] = await connection.query('SELECT * FROM peserta_pelatihan WHERE pelatihan_id = ? AND member_id = ?', [pelatihan_id, member_id]);
        if (pesertaResults.length > 0) {
            await connection.rollback();
            return res.status(400).json({ title: 'Pendaftaran', message: `Anda sudah mendaftar ke dalam ${pelatihan.judul_pelatihan}` });
        }

        // 3. Generate kode unik
        let isUnique = false;
        let kode;
        do {
            const transformedIdentitas = transformIdentitas(noIdentitas);
            const randomChars = generateRandomChars(9);
            const combinedString = transformedIdentitas + randomChars;
            const shuffledString = shuffleString(combinedString);
            kode = transformToRandomChars(shuffledString);

            isUnique = await isKodeUnique(kode);
        } while (!isUnique);

        // 4. Simpan pendaftaran ke peserta_pelatihan
        await connection.query('INSERT INTO peserta_pelatihan (pelatihan_id, member_id, kode, kirim) VALUES (?, ?, ?, ?)', [pelatihan_id, member_id, kode, 0]);

        // 5. Proses badge data
        const tahunKey = noIdentitas.split('.').pop();
        console.log('tahun key: ' + tahunKey);
        let badgeData = {};

        try {
            if (typeof member.badge === 'string' && member.badge.trim() !== '') {
                badgeData = JSON.parse(member.badge);
            } else if (typeof member.badge === 'object' && member.badge !== null) {
                badgeData = member.badge; // Jika badge sudah berupa objek, gunakan langsung
            }
        } catch (parseError) {
            console.error('❌ Error parsing badge data:', parseError);
            await connection.rollback();
            return res.status(500).json({ message: 'Gagal memproses data badge', rawData: member.badge });
        }
        console.log('badge data:', badgeData);
        // Pastikan badgeData[tahunKey] terdefinisi
        if (!badgeData[tahunKey]) {
            badgeData[tahunKey] = {};
        }

        // Cek apakah pelatihan sudah terdaftar
        const existingEntries = Object.values(badgeData[tahunKey]).map(p => p.pelatihan_id);
        if (existingEntries.includes(pelatihan_id)) {
            await connection.rollback();
            return res.status(400).json({ message: 'Member sudah terdaftar di pelatihan ini' });
        }

        // 6. Tambahkan pelatihan ke dalam data badge
        const newIndex = Object.keys(badgeData[tahunKey]).length;
        badgeData[tahunKey][newIndex] = {
            pelatihan_id: pelatihan.id,
            judul_pelatihan: pelatihan.judul_pelatihan,
            deskripsi_pelatihan: pelatihan.deskripsi_pelatihan,
            narasumber: pelatihan.narasumber,
            badge: pelatihan.badge,
            status: "ongoing"
        };

        console.log('badgeData setelah diupdate:', badgeData); // Debugging

        // 7. Update badge di tabel members
        await connection.query('UPDATE members SET badge = ? WHERE id = ?', [JSON.stringify(badgeData), member_id]);

        // 8. Commit transaksi
        await connection.commit();
        res.json({ message: 'Berhasil mendaftar pelatihan', kode: kode, badge: badgeData });
    } catch (error) {
        console.error('❌ Error:', error);
        await connection.rollback();
        res.status(500).json({ message: 'Terjadi kesalahan', error: error.message });
    } finally {
        connection.release();
    }
});

// Endpoint untuk menyelesaikan pelatihan
router.post('/selesai-pelatihan', (req, res) => {
    const { pelatihan_id, kode, user_id } = req.body;

    // 1. Cek apakah kode pelatihan valid
    db.query(
        'SELECT * FROM pelatihan_member WHERE id = ? AND kode = ?',
        [pelatihan_id, kode],
        (err, pelatihan) => {
            if (err) {
                console.error('❌ Error query pelatihan:', err);
                return res.status(500).json({ message: 'Gagal menyelesaikan pelatihan' });
            }

            if (pelatihan.length === 0) {
                return res.status(400).json({ message: 'Kode pelatihan tidak valid' });
            }

            // 2. Ambil badge dari pelatihan
            const badgePelatihan = pelatihan[0].badge;
            if (!badgePelatihan) {
                return res.status(400).json({ message: 'Badge tidak ditemukan untuk pelatihan ini' });
            }

            // 3. Update badge di table members berdasarkan user_id
            db.query(
                'SELECT badge FROM members WHERE user_id = ?', // Ubah id menjadi user_id
                [user_id],
                (err, member) => {
                    if (err) {
                        console.error('❌ Error query members:', err);
                        return res.status(500).json({ message: 'Gagal menyelesaikan pelatihan' });
                    }

                    // Pastikan badges selalu berupa array
                    let badges = member[0].badge || []; // Jika badge null/undefined, gunakan array kosong
                    if (typeof badges === 'string') {
                        try {
                            badges = JSON.parse(badges); // Konversi string JSON ke array
                        } catch (error) {
                            console.error('❌ Error parsing badges:', error);
                            badges = []; // Jika parsing gagal, gunakan array kosong
                        }
                    }

                    // Tambahkan badge baru ke array
                    badges.push({
                        badge: badgePelatihan,
                        pelatihan_id: pelatihan_id,
                        tanggal_selesai: new Date().toISOString(),
                    });

                    // Update badge di database
                    db.query(
                        'UPDATE members SET badge = ? WHERE user_id = ?', // Ubah id menjadi user_id
                        [JSON.stringify(badges), user_id], // Simpan sebagai JSON string
                        (err, result) => {
                            if (err) {
                                console.error('❌ Error update members:', err);
                                return res.status(500).json({ message: 'Gagal menyelesaikan pelatihan' });
                            }

                            // 4. Beri respons sukses
                            res.json({ message: 'Pelatihan selesai! Badge telah ditambahkan.', badge: badgePelatihan });
                        }
                    );
                }
            );
        }
    );
});

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

// endpoint untuk mendapatkan member untuk mengambil status pelatihan di badge
router.get('/members/id/:member_id/training/:training_id', async (req, res) => {
    const { member_id, training_id } = req.params;

    try {
        // Ambil data member termasuk no_identitas & badge
        const [results] = await db.promise().query(
            `SELECT id AS member_id, no_identitas, badge FROM members WHERE id = ?`, 
            [member_id]
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

            // Jika tidak ada data untuk key tertentu, langsung kembalikan response kosong
            if (!badgeObject || typeof badgeObject !== "object" || !badgeObject[key]) {
                console.log("⚠️ Tidak ada badge untuk key ini.");
                return res.json({
                    member_id: member.member_id,
                    no_identitas: member.no_identitas,
                    badge: []
                });
            }

            // Ubah object menjadi array
            filteredBadge = Object.values(badgeObject[key]);

            // Jika tidak ada badge dengan pelatihan_id yang cocok, langsung return response kosong
            if (!filteredBadge.some(b => b.pelatihan_id == training_id)) {
                console.log("⚠️ Tidak ada badge yang sesuai dengan training_id.");
                return res.json({
                    member_id: member.member_id,
                    no_identitas: member.no_identitas,
                    badge: []
                });
            }

            // Filter hanya yang memiliki pelatihan_id yang cocok
            filteredBadge = filteredBadge.filter(b => b.pelatihan_id == training_id);
            console.log("🎯 Filtered Badge Sesuai Training:", filteredBadge);
        } catch (error) {
            console.error("❌ Error parsing badge:", error);
        }

        res.json({
            no_identitas: member.no_identitas,
            badge: filteredBadge
        });
    } catch (error) {
        console.error("❌ Error mengambil data member:", error);
        res.status(500).json({ message: "Terjadi kesalahan pada server" });
    }
});

// endpoint untuk mengambil data member di pelatihan dengan nilai kembali nama member, kode, actions
router.get("/peserta-pelatihan/:pelatihanId/pendaftar", async (req, res) => {
    try {
        const { pelatihanId } = req.params;

        // Query untuk mendapatkan member_id dan kode dari peserta_pelatihan
        const peserta = await knex("peserta_pelatihan")
            .select("member_id", "kode")
            .where("pelatihan_id", pelatihanId);

        if (!peserta.length) {
            return res.status(404).json({ message: "Peserta tidak ditemukan" });
        }

        // Ambil member_id yang unik untuk query efisien
        const memberIds = peserta.map(p => p.member_id);

        // Query untuk mendapatkan nama berdasarkan member_id
        const members = await knex("members")
            .select("id", "nama")
            .whereIn("id", memberIds);

        // Buat mapping id -> nama untuk akses cepat
        const memberMap = {};
        members.forEach(member => {
            memberMap[member.id] = member.nama;
        });

        // Gabungkan data peserta dengan nama
        const result = peserta.map(p => ({
            nama: memberMap[p.member_id] || "Nama tidak ditemukan",
            kode: p.kode,
            aksi: {
                deleteId: p.member_id, // ID untuk tombol Hapus
                kirimId: p.member_id,  // ID untuk tombol Kirim
            }
        }));

        res.json(result);
    } catch (error) {
        console.error("Error fetching data:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// DELETE peserta
router.delete("/peserta/:id", async (req, res) => {
    try {
        const { id } = req.params;
        await knex("peserta_pelatihan").where({ id }).del();
        res.json({ success: true, message: "Peserta berhasil dihapus" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal menghapus peserta" });
    }
});

// UPDATE status kirim
router.put("/peserta/:id/kirim", async (req, res) => {
    try {
        const { id } = req.params;
        await knex("peserta_pelatihan").where({ id }).update({ kirim: 1 });
        res.json({ success: true, message: "Status berhasil diperbarui" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal memperbarui status" });
    }
});

module.exports = router;
