const express = require('express');
const router = express.Router();
const db = require('../db');
const db2 = require('../dbPool');
const knex = require("../dbKnex");
const moment = require('moment');
const excel = require('exceljs');

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

// Fungsi untuk menghitung lama pelatihan
const calculateDuration = (startDate, endDate) => {
    const duration = endDate - startDate;
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(months / 12);

    return {
        years,
        months: months % 12,
        days: days % 30,
        hours: hours % 24,
        minutes: minutes % 60,
        seconds: seconds % 60
    };
};

// endpoint untuk mendaftar pelatihan
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
            status: "ongoing",
            generasi: tahunKey
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
router.post('/selesai-pelatihan', async (req, res) => {
    const { pelatihan_id, kode, idMember } = req.body;

    // Mulai transaksi
    const connection = await db2.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Cari data di tabel peserta_pelatihan
        const [pesertaResults] = await connection.query(
            'SELECT * FROM peserta_pelatihan WHERE pelatihan_id = ? AND member_id = ?',
            [pelatihan_id, idMember]
        );

        if (pesertaResults.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Data peserta pelatihan tidak ditemukan' });
        }

        const peserta = pesertaResults[0];

        // 2. Validasi kode
        if (peserta.kode !== kode) {
            await connection.rollback();
            return res.status(400).json({ message: 'Kode pelatihan tidak valid' });
        }

        // 3. Update waktu_selesai di tabel peserta_pelatihan
        const waktuSelesai = moment().format('YYYY-MM-DD HH:mm:ss');
        await connection.query(
            'UPDATE peserta_pelatihan SET waktu_selesai = ? WHERE pelatihan_id = ? AND member_id = ?',
            [waktuSelesai, pelatihan_id, idMember]
        );

        // 4. Cari data di tabel members
        const [memberResults] = await connection.query(
            'SELECT no_identitas, badge FROM members WHERE id = ?',
            [idMember]
        );

        if (memberResults.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Member tidak ditemukan' });
        }

        const member = memberResults[0];

        // 5. Ambil 2 digit terakhir dari no_identitas
        const tahunKey = member.no_identitas.slice(-2);

        // 6. Parse data badge
        let badgeData = {};
        try {
            badgeData = typeof member.badge === 'string' ? JSON.parse(member.badge) : member.badge;
        } catch (error) {
            await connection.rollback();
            return res.status(500).json({ message: 'Gagal memproses data badge', error: error.message });
        }

        // 7. Cari pelatihan_id di dalam badgeData
        if (!badgeData[tahunKey]) {
            await connection.rollback();
            return res.status(400).json({ message: 'Tidak ada badge untuk tahun ini' });
        }

        let pelatihanIndex = null;
        for (const index in badgeData[tahunKey]) {
            if (badgeData[tahunKey][index].pelatihan_id === pelatihan_id) {
                pelatihanIndex = index;
                break;
            }
        }

        if (pelatihanIndex === null) {
            await connection.rollback();
            return res.status(400).json({ message: 'Pelatihan tidak ditemukan dalam badge' });
        }

        // 8. Hitung lama_pelatihan
        const waktuDaftar = new Date(peserta.waktu_daftar);
        const waktuSelesaiDate = new Date(waktuSelesai);
        const lamaPelatihan = calculateDuration(waktuDaftar, waktuSelesaiDate);

        // 9. Update status dan tambahkan waktu_daftar, waktu_selesai, lama_pelatihan
        badgeData[tahunKey][pelatihanIndex].status = 'completed';
        badgeData[tahunKey][pelatihanIndex].waktu_daftar = peserta.waktu_daftar;
        badgeData[tahunKey][pelatihanIndex].waktu_selesai = waktuSelesai;
        badgeData[tahunKey][pelatihanIndex].lama_pelatihan = lamaPelatihan;

        // 10. Update badge di tabel members
        await connection.query(
            'UPDATE members SET badge = ? WHERE id = ?',
            [JSON.stringify(badgeData), idMember]
        );

        // Commit transaksi
        await connection.commit();

        // Beri respons sukses
        res.json({ 
            message: 'Pelatihan selesai! Badge telah diperbarui.', 
            badge: badgeData[tahunKey][pelatihanIndex] 
        });

    } catch (error) {
        await connection.rollback();
        console.error('❌ Error:', error);
        res.status(500).json({ message: 'Terjadi kesalahan pada server', error: error.message });
    } finally {
        connection.release();
    }
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

// endpoint hitung jumlah pendaftar
router.get("/:pelatihanId/total-pendaftar", async (req, res) => {
    try {
        const { pelatihanId } = req.params;

        // Hitung jumlah member_id berdasarkan pelatihan_id
        const [countResult] = await knex("peserta_pelatihan")
            .count("member_id as total")
            .where("pelatihan_id", pelatihanId);

        res.json({ total: countResult.total || 0 });
    } catch (error) {
        console.error("❌ Error fetching total pendaftar:", error);
        res.status(500).json({ message: "Terjadi kesalahan", error: error.message });
    }
});

// endpoint untuk mengambil data member di pelatihan dengan nilai kembali nama member, kode, actions
router.get("/peserta-pelatihan/:pelatihanId/pendaftar", async (req, res) => {
    try {
        const { pelatihanId } = req.params;

        // Query untuk mendapatkan member_id dan kode dari peserta_pelatihan
        const peserta = await knex("peserta_pelatihan")
            .select("member_id", "kode", "pelatihan_id", "kirim")
            .where("pelatihan_id", pelatihanId);

        if (!peserta.length) {
            return res.json([]); // Kembalikan array kosong
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
                pelatihanId: p.pelatihan_id, // Tambahkan pelatihan_id
                isKirim: p.kirim === 1 // Tambahkan status kirim
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
        const { pelatihan_id, member_id } = req.body;

        // Update status kirim berdasarkan pelatihan_id dan member_id
        await knex("peserta_pelatihan")
            .where({ pelatihan_id, member_id })
            .update({ kirim: 1 });

        res.json({ success: true, message: "Status berhasil diperbarui" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal memperbarui status" });
    }
});

// update status di badge jika pelatihan tidak selesai
router.put("/update-status/uncompleted", async (req, res) => {
    try {
        console.log("📥 Data diterima di backend:", req.body);

        const { idMember, pelatihanId } = req.body;
        const memberId = idMember;

        if (!memberId || !pelatihanId) {
            return res.status(400).json({ message: "memberId atau pelatihanId tidak boleh kosong" });
        }

        // Ambil data badge dari member
        const [member] = await knex("members").select("badge").where("id", memberId);

        if (!member) {
            return res.status(404).json({ message: "Member tidak ditemukan" });
        }

        // Pastikan badge dalam format JSON yang benar
        let badgeData;
        try {
            badgeData = typeof member.badge === "string" ? JSON.parse(member.badge) : member.badge;
        } catch (error) {
            return res.status(500).json({ message: "Gagal membaca data badge", error: error.message });
        }

        console.log("🔍 Badge sebelum update:", badgeData);

        // Loop untuk mencari `pelatihan_id` dalam objek badge
        let updated = false;
        for (const tahunKey in badgeData) {
            for (const index in badgeData[tahunKey]) {
                if (badgeData[tahunKey][index].pelatihan_id === pelatihanId) {
                    badgeData[tahunKey][index].status = "uncompleted"; // Update status
                    updated = true;
                    break;
                }
            }
            if (updated) break;
        }

        if (!updated) {
            return res.status(400).json({ message: "Pelatihan tidak ditemukan dalam badge" });
        }

        // Simpan kembali ke database
        await knex("members")
            .where("id", memberId)
            .update({ badge: JSON.stringify(badgeData) });

        console.log("✅ Badge berhasil diperbarui:", badgeData);
        res.json({ message: "Status berhasil diperbarui", updatedBadge: badgeData });
    } catch (error) {
        console.error("❌ Error di backend:", error);
        res.status(500).json({ message: "Terjadi kesalahan", error: error.message });
    }
});

// Endpoint untuk mendapatkan kode pelatihan berdasarkan idMember dan idTraining
router.get('/peserta-pelatihan/kode/:idMember/:idTraining', async (req, res) => {
    const { idMember, idTraining } = req.params;

    try {
        // Cari data di tabel peserta_pelatihan berdasarkan pelatihan_id dan member_id
        const [results] = await db2.query(
            'SELECT kode, kirim FROM peserta_pelatihan WHERE pelatihan_id = ? AND member_id = ?',
            [idTraining, idMember]
        );

        // Jika data tidak ditemukan
        if (results.length === 0) {
            return res.status(404).json({ 
                message: 'Anda tidak terdaftar sebagai peserta atau data Anda dihapus admin. Silahkan konfirmasi ke Admin.' 
            });
        }

        const peserta = results[0];

        // Cek status kirim
        if (peserta.kirim === 1) {
            // Jika kirim bernilai 1, kembalikan kode
            return res.json({ kode: peserta.kode });
        } else {
            // Jika kirim bernilai 0, kembalikan pesan bahwa kode belum dikirim
            return res.status(400).json({ 
                message: 'Kode belum dikirim admin atau Anda belum menyelesaikan pelatihan.' 
            });
        }
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ message: 'Terjadi kesalahan pada server', error: error.message });
    }
});

// Endpoint untuk export data peserta pelatihan ke Excel
router.get('/export-peserta/:pelatihanId', async (req, res) => {
    const { pelatihanId } = req.params;
    const connection = await db2.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Ambil data pelatihan dari pelatihan_member
        const [pelatihanResults] = await connection.query(
            'SELECT judul_pelatihan, tanggal_pelatihan, deskripsi_pelatihan, link, tanggal_berakhir, narasumber, badge FROM pelatihan_member WHERE id = ?',
            [pelatihanId]
        );

        if (pelatihanResults.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Pelatihan tidak ditemukan' });
        }

        const pelatihan = pelatihanResults[0];

        // 2. Ambil data peserta dari peserta_pelatihan
        const [pesertaResults] = await connection.query(
            'SELECT member_id, waktu_daftar, waktu_selesai FROM peserta_pelatihan WHERE pelatihan_id = ?',
            [pelatihanId]
        );

        if (pesertaResults.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Tidak ada peserta untuk pelatihan ini' });
        }

        // 3. Ambil semua member_id untuk query berikutnya
        const memberIds = pesertaResults.map(p => p.member_id);

        // 4. Ambil data member dari tabel members
        const [memberResults] = await connection.query(
            `SELECT 
                id, no_identitas, tipe_keanggotaan, institusi, website, email, 
                alamat, wilayah, nama, nomor_wa, additional_members_info, badge 
             FROM members 
             WHERE id IN (?)`,
            [memberIds]
        );

        await connection.commit();

        // 5. Gabungkan data peserta dengan data member
        const combinedData = pesertaResults.map(peserta => {
            const member = memberResults.find(m => m.id === peserta.member_id);
            return {
                ...peserta,
                ...member,
                pelatihan: pelatihan
            };
        });

        // 6. Buat workbook Excel
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet(`Pendaftar_${pelatihan.judul_pelatihan}`);

        // 7. Definisikan kolom
        worksheet.columns = [
            { header: 'No Identitas', key: 'no_identitas', width: 20 },
            { header: 'Nama', key: 'nama', width: 25 },
            { header: 'Tipe Keanggotaan', key: 'tipe_keanggotaan', width: 20 },
            { header: 'Institusi', key: 'institusi', width: 30 },
            { header: 'Website', key: 'website', width: 25 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Alamat', key: 'alamat', width: 40 },
            { header: 'Wilayah', key: 'wilayah', width: 20 },
            { header: 'Nomor WA', key: 'nomor_wa', width: 20 },
            { header: 'Member Tambahan', key: 'additional_members_info', width: 30 },
            { header: 'Waktu Daftar', key: 'waktu_daftar', width: 25 },
            { header: 'Waktu Selesai', key: 'waktu_selesai', width: 25 },
            { header: 'Judul Pelatihan', key: 'judul_pelatihan', width: 30 },
            { header: 'Tanggal Pelatihan', key: 'tanggal_pelatihan', width: 20 },
            { header: 'Narasumber', key: 'narasumber', width: 25 }
        ];

        // 8. Tambahkan data ke worksheet
        combinedData.forEach(data => {
            worksheet.addRow({
                no_identitas: data.no_identitas,
                nama: data.nama,
                tipe_keanggotaan: data.tipe_keanggotaan,
                institusi: data.institusi,
                website: data.website || '-',
                email: data.email,
                alamat: data.alamat,
                wilayah: data.wilayah,
                nomor_wa: data.nomor_wa,
                additional_members_info: data.additional_members_info || 'Tidak ada member tambahan',
                waktu_daftar: data.waktu_daftar ? moment(data.waktu_daftar).format('YYYY-MM-DD HH:mm:ss') : '-',
                waktu_selesai: data.waktu_selesai ? moment(data.waktu_selesai).format('YYYY-MM-DD HH:mm:ss') : '-',
                judul_pelatihan: data.pelatihan.judul_pelatihan,
                tanggal_pelatihan: data.pelatihan.tanggal_pelatihan ? moment(data.pelatihan.tanggal_pelatihan).format('YYYY-MM-DD') : '-',
                narasumber: data.pelatihan.narasumber
            });
        });

        // 9. Format header
        worksheet.getRow(1).eachCell((cell) => {
            cell.font = { bold: true };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD3D3D3' }
            };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });

        // 10. Set response headers untuk download Excel
        const timestamp = moment().format('YYYYMMDD_HHmmss');
        const filename = `Dataset_Pendaftaran_${pelatihan.judul_pelatihan}_${timestamp}.xlsx`;

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=${encodeURIComponent(filename)}`
        );

        // 11. Kirim workbook sebagai response
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        await connection.rollback();
        console.error('❌ Error:', error);
        res.status(500).json({ message: 'Terjadi kesalahan pada server', error: error.message });
    } finally {
        connection.release();
    }
});

module.exports = router;
