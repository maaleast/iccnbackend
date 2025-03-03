const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');

const router = express.Router();

// Konfigurasi penyimpanan file
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'file_sk') {
            cb(null, 'uploads/file_sk/'); // Simpan file SK ke folder khusus
        } else if (file.fieldname === 'bukti_pembayaran') {
            cb(null, 'uploads/bukti_pembayaran/'); // Simpan bukti pembayaran ke folder khusus
        } else {
            cb(new Error('Jenis file tidak valid!'));
        }
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // Rename file agar unik
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Maksimal 10MB
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


router.post('/register-member', upload.fields([{ name: 'file_sk' }, { name: 'bukti_pembayaran' }]), (req, res) => {
    const { user_id, tipe_keanggotaan, institusi, website, email, alamat, wilayah, nama_pembayar, nominal_transfer, nomor_wa, nama_kuitansi } = req.body;
    let { additional_members_info } = req.body; // Bisa kosong

    if (!req.files || !req.files['file_sk'] || !req.files['bukti_pembayaran']) {
        return res.status(400).json({ message: 'File SK dan Bukti Pembayaran harus diunggah!' });
    }

    const fileSkPath = `/uploads/file_sk/${req.files['file_sk'][0].filename}`;
    const buktiPembayaranPath = `/uploads/bukti_pembayaran/${req.files['bukti_pembayaran'][0].filename}`;

    // Kalau additional_members_info kosong, set jadi NULL
    additional_members_info = additional_members_info ? additional_members_info : null;

    db.query(
        'INSERT INTO members (user_id, tipe_keanggotaan, institusi, website, email, alamat, wilayah, nama_pembayar, nominal_transfer, nomor_wa, nama_kuitansi, additional_members_info, file_sk, bukti_pembayaran, status_verifikasi, tanggal_submit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "PENDING", NOW())',
        [user_id, tipe_keanggotaan, institusi, website, email, alamat, wilayah, nama_pembayar, nominal_transfer, nomor_wa, nama_kuitansi, additional_members_info, fileSkPath, buktiPembayaranPath],
        (err, result) => {
            if (err) return res.status(500).json({ message: 'Gagal mendaftar sebagai member', error: err });

            // Update role user menjadi 'member'
            db.query(
                'UPDATE users SET role = "member" WHERE id = ?',
                [user_id],
                (err, result) => {
                    if (err) return res.status(500).json({ message: 'Gagal memperbarui role pengguna', error: err });

                    res.status(201).json({ message: 'Pendaftaran member berhasil, menunggu verifikasi', file_sk: fileSkPath, bukti_pembayaran: buktiPembayaranPath });
                }
            );
        }
    );
});




//** NGECEK UDAH DAFTAR BELUM */
router.post('/checkUserRole', (req, res) => {
    const { user_id } = req.body;

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

        // Jika role bukan 'member', arahkan ke halaman pendaftaran
        res.json({ role: userRole, message: 'Anda belum menjadi member. Silakan daftar terlebih dahulu.' });
    });
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
        res.json(results);
    });
});



// **VERIFIKASI UDAH DITERIMA BLOM DI DASHBOARD MEMBER
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

        // Default response
        res.json({ status: 'UNKNOWN', message: 'Status verifikasi tidak diketahui.' });
    });
});


module.exports = router;
