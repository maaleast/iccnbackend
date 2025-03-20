const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Konfigurasi penyimpanan file
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'file_sk') {
            cb(null, 'uploads/file_sk/');
        } else if (file.fieldname === 'bukti_pembayaran' || file.fieldname === 'bukti_pembayaran_perpanjang') {
            cb(null, 'uploads/bukti_pembayaran/');
        } else if (file.fieldname === 'logo') {
            const { tipe_keanggotaan } = req.body;
            if (tipe_keanggotaan === 'Universitas') {
                cb(null, 'uploads/universitas/');
            } else if (tipe_keanggotaan === 'Perusahaan') {
                cb(null, 'uploads/perusahaan/');
            } else {
                cb(new Error('Tipe keanggotaan tidak valid untuk upload logo!'));
            }
        } else {
            cb(new Error('Jenis file tidak valid!'));
        }
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const fileTypes = /pdf|doc|docx|png|jpg|jpeg/;
        const extName = fileTypes.test(path.extname(file.originalname).toLowerCase());
        const mimeType = fileTypes.test(file.mimetype);

        if (extName && mimeType) {
            return cb(null, true);
        } else {
            return cb(new Error('Format file tidak didukung!'));
        }
    }
});

async function generateUniqueIdentitas(tipe_keanggotaan) {
    const tahun = new Date().getFullYear() % 100;
    let prefix = tipe_keanggotaan === "Universitas" ? "UN" :
                 tipe_keanggotaan === "Perusahaan" ? "PR" :
                 tipe_keanggotaan === "Individu" ? "IN" : null;

    if (!prefix) throw new Error("Tipe keanggotaan tidak valid!");

    let counter = 1, identitas, isUnique = false;

    while (!isUnique) {
        identitas = `${tahun}${prefix}${String(counter).padStart(3, '0')}`;
        
        const [rows] = await db.promise().query(
            'SELECT COUNT(*) as count FROM members WHERE no_identitas = ?',
            [identitas]
        );

        if (rows[0].count === 0) isUnique = true;
        else counter++;
    }

    return identitas;
}

//** NGECEK STATUS ROLE */
//** NGECEK STATUS ROLE */
router.get('/checkUserRole', (req, res) => {
    const { user_id } = req.query;

    if (!user_id) {
        return res.status(400).json({ message: 'User ID tidak ditemukan!' });
    }

    // Query untuk memeriksa role pengguna di tabel users
    db.query('SELECT role FROM users WHERE id = ?', [user_id], (err, results) => {
        if (err) return res.status(500).json({ message: 'Terjadi kesalahan server', error: err });

        // Jika tidak ada data pengguna
        if (results.length === 0) {
            return res.status(404).json({ message: 'Pengguna tidak ditemukan!' });
        }

        const userRole = results[0].role;

        // Jika role adalah 'member', arahkan ke halaman member
        if (userRole === 'member') {
            return res.json({ role: 'member', message: 'Anda sudah menjadi member. Selamat datang!' });
        }

        // Jika role adalah 'admin', arahkan ke halaman admin
        if (userRole === 'admin') {
            return res.json({ role: 'admin', message: 'Anda adalah admin. Selamat datang!' });
        }

        // Jika role bukan 'member' atau 'admin', arahkan ke halaman pendaftaran
        res.json({ role: null, message: 'Anda belum menjadi member. Silakan daftar terlebih dahulu.' });
    });
});















// UNTUK REGISTER MEMBERRRRRRRRR
// **REGISTER MEMBER**
// Endpoint untuk menambahkan saldo dari daftar member
router.post('/addsaldomember', async (req, res) => {
    try {
        console.log("Data yang diterima di /addsaldomember:", req.body);

        const { nominal_transfer, no_identitas, nama_kuitansi, nama } = req.body;

        // Validasi input
        if (!nominal_transfer || !no_identitas || !nama_kuitansi || !nama) {
            return res.status(400).json({ message: 'Semua field wajib diisi!' });
        }

        // Catat pendapatan ke tabel admin_laporan_keuangan
        await db.promise().query(
            'INSERT INTO admin_laporan_keuangan (status, jumlah, deskripsi, tanggal_waktu) VALUES (?, ?, ?, ?)',
            ['MASUK', nominal_transfer, `Saldo bertambah dari pendaftaran member ${no_identitas} (${nama_kuitansi}) dari member bernama ${nama}`, new Date().toISOString()]
        );

        console.log("Saldo berhasil ditambahkan ke database.");
        res.status(201).json({ message: 'Saldo berhasil ditambahkan' });
    } catch (err) {
        console.error('Error saat menambahkan saldo:', err);
        res.status(500).json({ message: 'Gagal menambahkan saldo', error: err });
    }
});

// ===================================
// endpoint daftar form member

router.post('/register-member', upload.fields([{ name: 'file_sk' }, { name: 'bukti_pembayaran' }, { name: 'logo' }]), async (req, res) => {
    try {
        const { tipe_keanggotaan, institusi, website, email, alamat, wilayah, name, nominal_transfer, nomor_wa, nama_kuitansi } = req.body;
        let { additional_members_info } = req.body;

        // Validasi input
        if (!tipe_keanggotaan || !institusi || !email || !name || !nominal_transfer || !nomor_wa || !nama_kuitansi) {
            return res.status(400).json({ message: 'Semua field wajib diisi!' });
        }

        if (!req.files || !req.files['file_sk'] || !req.files['bukti_pembayaran']) {
            return res.status(400).json({ message: 'File SK dan Bukti Pembayaran harus diunggah!' });
        }

        // Ambil user_id berdasarkan email
        db.query('SELECT id FROM users WHERE email = ?', [email], async (err, results) => {
            if (err) {
                console.error('Error saat mengambil user_id:', err);
                return res.status(500).json({ message: 'Gagal mengambil user_id', error: err });
            }
            if (results.length === 0) {
                return res.status(404).json({ message: 'User dengan email tersebut tidak ditemukan' });
            }

            const user_id = results[0].id; // Ambil id dari hasil query

            // Simpan path file yang diunggah
            const fileSkPath = `/uploads/file_sk/${req.files['file_sk'][0].filename}`;
            const buktiPembayaranPath = `/uploads/bukti_pembayaran/${req.files['bukti_pembayaran'][0].filename}`;
            const logoPath = req.files['logo'] ? `/uploads/${tipe_keanggotaan.toLowerCase()}/${req.files['logo'][0].filename}` : null;

            additional_members_info = additional_members_info ? additional_members_info : null;

            const tanggalSubmit = new Date();
            const masaAktif = new Date(tanggalSubmit);
            masaAktif.setFullYear(masaAktif.getFullYear() + 1);
            const masaAktifFormatted = masaAktif.toISOString().split('T')[0];

            // Generate no_identitas
            const no_identitas = await generateUniqueIdentitas(tipe_keanggotaan);

            // Insert ke tabel members
            db.query(
                'INSERT INTO members (user_id, no_identitas, tipe_keanggotaan, institusi, website, email, alamat, wilayah, name, nominal_transfer, nomor_wa, nama_kuitansi, additional_members_info, file_sk, bukti_pembayaran, logo, status_verifikasi, tanggal_submit, masa_aktif) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "PENDING", NOW(), ?)',
                [user_id, no_identitas, tipe_keanggotaan, institusi, website, email, alamat, wilayah, name, nominal_transfer, nomor_wa, nama_kuitansi, additional_members_info, fileSkPath, buktiPembayaranPath, logoPath, masaAktifFormatted],
                async (err, result) => {
                    if (err) {
                        console.error('Error saat mendaftar member:', err);
                        return res.status(500).json({ message: 'Gagal mendaftar sebagai member', error: err });
                    }

                    // Update role pengguna menjadi 'member'
                    db.query('UPDATE users SET role = "member" WHERE id = ?', [user_id], async (err, result) => {
                        if (err) {
                            console.error('Error saat memperbarui role pengguna:', err);
                            return res.status(500).json({ message: 'Gagal memperbarui role pengguna', error: err });
                        }

                        res.status(201).json({ 
                            message: 'Pendaftaran member berhasil, menunggu verifikasi', 
                            file_sk: fileSkPath, 
                            bukti_pembayaran: buktiPembayaranPath, 
                            logo: logoPath,
                            masa_aktif: masaAktifFormatted,
                            no_identitas: no_identitas, // Pastikan ini ada
                        });
                    });
                }
            );
        });
    } catch (err) {
        console.error('Error saat mendaftar member:', err);
        res.status(500).json({ message: 'Gagal mendaftar sebagai member', error: err });
    }
});







// **REQUEST PERPANJANG MEMBER**
router.post('/request-perpanjang', upload.single('bukti_pembayaran_perpanjang'), (req, res) => {
    const { user_id, nama_kuitansi, nominal_transfer } = req.body;
    const buktiPembayaranPath = req.file ? `/uploads/bukti_pembayaran/${req.file.filename}` : null;

    if (!user_id || !nama_kuitansi || !nominal_transfer || !buktiPembayaranPath) {
        return res.status(400).json({ message: 'User ID, Nama Kuitansi, Jumlah Transfer, dan Bukti Pembayaran wajib diisi!' });
    }

    // Update data di tabel members
    db.query(
        `UPDATE members 
         SET nama_kuitansi = ?, nominal_transfer = ?, bukti_pembayaran = ?, status_verifikasi = 'PENDING PERPANJANG', tanggal_submit = NOW()
         WHERE user_id = ?`,
        [nama_kuitansi, nominal_transfer, buktiPembayaranPath, user_id],
        (err, result) => {
            if (err) return res.status(500).json({ message: 'Gagal mengajukan perpanjangan', error: err });

            res.status(200).json({ message: 'Permohonan perpanjangan berhasil diajukan', bukti_pembayaran: buktiPembayaranPath });
        }
    );
});

// **VERIFIKASI MEMBER (ADMIN)**
router.put('/verify-member/:member_id', (req, res) => {
    const { member_id } = req.params;
    const { status, catatan } = req.body;

    if (!['DITERIMA', 'DITOLAK'].includes(status)) {
        return res.status(400).json({ message: 'Status harus DITERIMA atau DITOLAK' });
    }

    db.query(
        'UPDATE members SET status_verifikasi = ?, catatan = ? WHERE id = ?',
        [status, catatan, member_id],
        (err) => {
            if (err) return res.status(500).json({ message: 'Gagal memperbarui status', error: err });

            if (status === 'DITERIMA') {
                db.query('UPDATE users SET role = "member" WHERE id = (SELECT user_id FROM members WHERE id = ?)', [member_id]);
            }

            res.json({ message: `Status member diperbarui menjadi ${status}` });
        }
    );
});

// **GET Semua Data Pelatihan**
router.get('/pelatihan', (req, res) => {
    db.query('SELECT * FROM pelatihan_member', (err, results) => {
        if (err) {
            console.error('❌ Error mengambil data pelatihan:', err);
            return res.status(500).json({ message: 'Gagal mengambil data pelatihan' });
        }

        // Filter out sensitive fields (e.g., 'kode') from the results
        const filteredResults = results.map(item => {
            const { kode, ...rest } = item; // Exclude 'kode' from the response
            return rest;
        });

        res.json(filteredResults);
    });
});

//endpoint cek sudah terdaftar atau belum
router.post('/checkRegistrationStatus', (req, res) => {
    const { member_id, pelatihan_id } = req.body;

    db.query(
        'SELECT * FROM peserta_pelatihan WHERE member_id = ? AND pelatihan_id = ?',
        [member_id, pelatihan_id],
        (err, results) => {
            if (err) {
                console.error('Error checking registration status:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            if (results.length > 0) {
                res.json({ isRegistered: true });
            } else {
                res.json({ isRegistered: false });
            }
        }
    );
});

// enspoint untuk mendaftar pelatihan
router.post('/mendaftar-pelatihan', (req, res) => {
    const { pelatihan_id, member_id } = req.body;

    db.query(
        'SELECT * FROM pelatihan_member WHERE id = ?',
        [pelatihan_id],
        (err, results) => {
            if (err) {
                console.error('❌ Error query pelatihan:', err);
                return res.status(500).json({ message: 'Gagal mendaftar pelatihan' });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: 'Pelatihan tidak ditemukan' });
            }

            const { id, ...pelatihan } = results[0]; // Exclude 'kode' from the response

            db.query(
                'INSERT INTO peserta_pelatihan (pelatihan_id, member_id) VALUES (?, ?)',
                [pelatihan_id, member_id],
                (err) => {
                    if (err) {
                        console.error('❌ Error mendaftar pelatihan:', err);
                        return res.status(500).json({ message: 'Gagal mendaftar pelatihan' });
                    }

                    res.json({ message: 'Berhasil mendaftar pelatihan', pelatihan });
                }
            );
        }
    );
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

module.exports = router;

// Endpoint untuk mendapatkan badge berdasarkan user_id
router.get('/badge/:user_id', (req, res) => {
    const { user_id } = req.params;

    // 1. Ambil data badge dari tabel members berdasarkan user_id
    db.query(
        'SELECT badge FROM members WHERE user_id = ?',
        [user_id],
        (err, result) => {
            if (err) {
                console.error('❌ Error query members:', err);
                return res.status(500).json({ message: 'Gagal mengambil data badge' });
            }

            if (result.length === 0) {
                return res.status(404).json({ message: 'User tidak ditemukan' });
            }

            // 2. Ambil field badge dari hasil query
            const badges = result[0].badge;

            // 3. Pastikan badges berupa array
            let badgeList = [];
            if (badges) {
                try {
                    // Jika badges adalah string JSON, parse ke array
                    badgeList = typeof badges === 'string' ? JSON.parse(badges) : badges;
                } catch (error) {
                    console.error('❌ Error parsing badges:', error);
                    return res.status(500).json({ message: 'Gagal memproses data badge' });
                }
            }

            // 4. Beri respons dengan daftar badge
            res.json({ user_id, badges: badgeList });
        }
    );
});



// **CEK STATUS VERIFIKASI**
router.get('/checkVerificationStatus/:user_id', (req, res) => {
    const { user_id } = req.params;

    if (!user_id) {
        return res.status(400).json({ message: 'User ID tidak ditemukan!' });
    }

    // Query untuk mengambil status_verifikasi dari tabel members berdasarkan user_id
    db.query('SELECT status_verifikasi FROM members WHERE user_id = ?', [user_id], (err, results) => {
        if (err) {
            console.error('❌ Error fetching verification status:', err);
            return res.status(500).json({ message: 'Gagal mengambil status verifikasi' });
        }

        // Jika tidak ada data (belum mendaftar sebagai member)
        if (results.length === 0) {
            return res.json({ status: 'NOT_REGISTERED', message: 'Anda belum mendaftar sebagai member.' });
        }

        const statusVerifikasi = results[0].status_verifikasi?.trim(); // Bersihkan nilai dari spasi atau karakter yang tidak terlihat

        console.log('Status Verifikasi:', statusVerifikasi); // Debugging: Lihat nilai yang dikembalikan

        // Jika status_verifikasi NULL (belum diverifikasi)
        if (statusVerifikasi === null || statusVerifikasi === '') {
            return res.json({ status: 'PENDING', message: 'Anda sudah terdaftar sebagai member ICCN, Tunggu akun anda sedang diverifikasi oleh Admin.' });
        }

        // Jika status_verifikasi PENDING
        if (statusVerifikasi === 'PENDING') {
            return res.json({ status: 'PENDING', message: 'Anda sudah terdaftar sebagai member ICCN, Tunggu akun anda sedang diverifikasi oleh Admin.' });
        }

        // Jika status_verifikasi DITERIMA
        if (statusVerifikasi === 'DITERIMA') {
            return res.json({ status: 'DITERIMA', message: 'Anda sudah diverifikasi. Selamat menggunakan Member Dashboard!' });
        }

        // Jika status_verifikasi DITOLAK
        if (statusVerifikasi === 'DITOLAK') {
            return res.json({ status: 'DITOLAK', message: 'Anda ditolak, silahkan mendaftar ulang pada tahun berikutnya. Terima kasih.' });
        }

        // Jika status_verifikasi PERPANJANG
        if (statusVerifikasi === 'PERPANJANG') {
            return res.json({ status: 'PERPANJANG', message: 'Perpanjang' });
        }

        // Jika status_verifikasi PERPANJANG
        if (statusVerifikasi === 'PENDING PERPANJANG') {
            return res.json({ status: 'PENDING PERPANJANG', message: 'PENDING PERPANJANG' });
        }

        // Default response
        res.json({ status: 'UNKNOWN', message: 'Status verifikasi tidak diketahui.' });
    });
});

//Mengambil beberapa info member untuk setting member dashboard
router.get('/member-info', (req, res) => {
    const userId = req.query.user_id; // Ambil user_id dari query parameter

    if (!userId) {
        return res.status(400).json({ message: 'User ID tidak ditemukan' });
    }

    const query = `
        SELECT tipe_keanggotaan, institusi, name, nomor_wa 
        FROM members 
        WHERE user_id = ?
    `;

    db.query(query, [userId], (err, results) => {
        if (err) {
            console.error('❌ Error mengambil data member:', err);
            return res.status(500).json({ message: 'Gagal mengambil data member' });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: 'Data member tidak ditemukan' });
        }

        res.json(results[0]); // Mengembalikan data member
    });
});

module.exports = router;