const express = require('express');
const db = require('../db'); // Koneksi database
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

console.log("✅ Auth routes loaded");

// Konfigurasi Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD
    }
});

// Fungsi untuk memastikan direktori ada
const ensureDirExists = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

// Konfigurasi Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let uploadPath = path.join(__dirname, '../uploads');

        if (file.fieldname === 'file_sk') {
            uploadPath = path.join(uploadPath, 'file_sk');
        } else if (file.fieldname === 'bukti_pembayaran') {
            uploadPath = path.join(uploadPath, 'bukti_pembayaran');
        } else if (file.fieldname === 'logo') {
            // Pastikan tipe_keanggotaan ada dalam request
            const tipeKeanggotaan = req.body.userTypen ? req.body.userType.toLowerCase().replace(/\s+/g, '_') : 'default';
            uploadPath = path.join(uploadPath, tipeKeanggotaan, 'logo');
        }

        ensureDirExists(uploadPath);
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

// upload dengan multer
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error('Format file tidak didukung!'));
        }
        cb(null, true);
    }
});

// Generate Unique ID
async function generateUniqueIdentitas(userType) {
    const tahun = new Date().getFullYear() % 100;
    const prefixMap = { Universitas: "UI", Perusahaan: "PR", Individu: "IN", Mahasiswa: "MA" };
    const prefix = prefixMap[userType];

    if (!prefix) throw new Error("Tipe keanggotaan tidak valid!");

    try {
        const [rows] = await db.promise().query(
            `SELECT MAX(CAST(SUBSTRING(no_identitas, 6, 3) AS UNSIGNED)) AS maxCounter 
             FROM members 
             WHERE no_identitas LIKE ?`,
            [`${tahun}.${prefix}%`]
        );

        // Ambil nilai maxCounter dan tambahkan 1 jika ada, atau mulai dari 1
        const counter = (rows[0]?.maxCounter || 0) + 1;

        // Format identitas baru
        return `${tahun}.${prefix}${String(counter).padStart(3, '0')}.01`;
    } catch (error) {
        console.error("Error generating unique identitas:", error);
        throw new Error("Gagal menghasilkan no_identitas");
    }
}

// **REGISTER USER**
router.post('/register', async (req, res) => {
    console.log("🔹 Register route hit");
    console.log("📥 Request Body:", req.body);

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ message: 'Semua field harus diisi' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = uuidv4();

    db.query(
        'INSERT INTO users (username, email, password, verification_token, is_verified, role) VALUES (?, ?, ?, ?, ?, ?)',
        [username, email, hashedPassword, verificationToken, false, null],
        async (err) => {
            if (err) {
                console.error("❌ Error saat registrasi:", err);
                return res.status(500).json({ message: 'Error saat registrasi', error: err });
            }

            try {
                await transporter.sendMail({
                    from: process.env.SMTP_EMAIL,
                    to: email,
                    subject: 'Verifikasi Akun ICCN',
                    html: `<p>Klik <a href="${process.env.BASE_URL}/auth/verify?token=${verificationToken}">di sini</a> untuk verifikasi akun.</p>`
                });

                res.status(201).json({ message: 'Registrasi berhasil! Cek email untuk verifikasi' });
            } catch (error) {
                console.error("❌ Gagal mengirim email:", error);
                res.status(500).json({ message: 'Gagal mengirim email verifikasi', error });
            }
        }
    );
});

// 📌 REGISTER MEMBER
router.post("/register-member", upload.fields([{ name: "file_sk" }, { name: "bukti_pembayaran" }, { name: "logo" }]), async (req, res) => {
    try {
        console.log("🔹 Register-Member route hit");
        console.log("🛠 Body:", req.body);
        console.log("🛠 Files:", req.files);

        const { username, email, password, userType, institutionName, websiteLink, address, region, personalName, transferAmount, whatsappGroupNumber, receiptName } = req.body;
        let { additional_members_info } = req.body;

        // 🔍 Validasi Input
        if (!username || !email || !password || !userType || !transferAmount) {
            return res.status(400).json({ message: "Semua field wajib diisi!" });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: "Format email tidak valid!" });
        }

        const waRegex = /^[0-9]+$/;
        if (whatsappGroupNumber && !waRegex.test(whatsappGroupNumber)) {
            return res.status(400).json({ message: "Nomor WA hanya boleh berisi angka!" });
        }

        // 🔍 Cek apakah email sudah terdaftar
        const [existingUsers] = await db.promise().query("SELECT id FROM users WHERE email = ?", [email]);
        if (existingUsers.length > 0) {
            return res.status(400).json({ message: "Email sudah terdaftar!" });
        }

        // 🔑 Hash Password
        const hashedPassword = await bcrypt.hash(password, 12);
        const verificationToken = uuidv4();

        // 🔍 Cek apakah file wajib diunggah
        if (!req.files || !req.files["file_sk"] || !req.files["bukti_pembayaran"]) {
            return res.status(400).json({ message: "File SK dan Bukti Pembayaran harus diunggah!" });
        }

        const fileSkPath = `/uploads/file_sk/${req.files["file_sk"][0].filename}`;
        const buktiPembayaranPath = `/uploads/bukti_pembayaran/${req.files["bukti_pembayaran"][0].filename}`;

        let logoPath = null;
        if (req.files["logo"]) {
            const userTypeDir = userType.toLowerCase().replace(/\s+/g, "_");
            logoPath = `/uploads/${userTypeDir}/logo/${req.files["logo"][0].filename}`;
        }

        additional_members_info = additional_members_info || null;
        const no_identitas = await generateUniqueIdentitas(userType);

        const tanggalSubmit = new Date();
        const masaAktif = new Date(tanggalSubmit);
        masaAktif.setFullYear(masaAktif.getFullYear() + 1);
        const masaAktifFormatted = masaAktif.toISOString().split("T")[0];

        // 🔥 Transaksi Database untuk menghindari corrupt data
        await db.promise().beginTransaction();

        // Insert ke table users
        const [userResult] = await db.promise().query(
            "INSERT INTO users (username, email, password, verification_token, is_verified, role) VALUES (?, ?, ?, ?, ?, ?)",
            [username, email, hashedPassword, verificationToken, false, "member"]
        );

        const user_id = userResult.insertId;

        // Insert ke table members
        await db.promise().query(
            "INSERT INTO members (user_id, no_identitas, tipe_keanggotaan, institusi, website, email, alamat, wilayah, nama, nominal_transfer, nomor_wa, nama_kuitansi, additional_members_info, file_sk, bukti_pembayaran, logo, status_verifikasi, tanggal_submit, masa_aktif, badge) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW(), ?, ?)",
            [user_id, no_identitas, userType, institutionName, websiteLink, email, address, region, personalName, transferAmount, whatsappGroupNumber, receiptName, additional_members_info, fileSkPath, buktiPembayaranPath, logoPath, masaAktifFormatted, "{}"]
        );

        // Catat pendapatan dari registrasi ke tabel admin_laporan_keuangan
        const deskripsi = `Pendaftaran Member dari ${no_identitas}, dengan nama ${personalName}, Nama kuitansinya ${receiptName}`;
        await db.promise().query(
            "INSERT INTO admin_laporan_keuangan (status, jumlah, deskripsi, tanggal_waktu) VALUES (?, ?, ?, NOW())",
            ["MASUK", transferAmount, deskripsi]
        );

        // 🔹 Kirim Email Verifikasi
        try {
            await transporter.sendMail({
                from: process.env.SMTP_EMAIL,
                to: email,
                subject: "Verifikasi Akun ICCN",
                html: `<p>Terima kasih telah mendaftar sebagai member ICCN. Klik <a href="${process.env.BASE_URL}/auth/verify?token=${verificationToken}">di sini</a> untuk verifikasi akun Anda.</p>`,
            });

            await db.promise().commit();

            res.status(201).json({
                message: "Pendaftaran member berhasil! Silakan cek email untuk verifikasi.",
                file_sk: fileSkPath,
                bukti_pembayaran: buktiPembayaranPath,
                logo: logoPath,
                masa_aktif: masaAktifFormatted,
                no_identitas: no_identitas,
            });
        } catch (emailError) {
            await db.promise().rollback(); // Rollback jika gagal kirim email
            console.error("❌ Gagal mengirim email:", emailError);
            res.status(500).json({ message: "Gagal mengirim email verifikasi, coba lagi nanti." });
        }
    } catch (error) {
        await db.promise().rollback();
        console.error("❌ Error saat registrasi:", error);
        res.status(500).json({ message: "Gagal mendaftar", error });
    }
});

// **VERIFIKASI EMAIL**
router.get('/verify', (req, res) => {
    console.log("🔹 Verify route hit");

    const { token } = req.query;
    if (!token) return res.status(400).json({ message: 'Token tidak valid' });

    db.query('SELECT * FROM users WHERE verification_token = ?', [token], (err, results) => {
        if (err || results.length === 0) {
            console.error("❌ Token verifikasi tidak ditemukan");
            return res.status(400).json({ message: 'Token verifikasi tidak valid' });
        }

        db.query(
            'UPDATE users SET is_verified = TRUE, verification_token = NULL WHERE verification_token = ?',
            [token],
            (err) => {
                if (err) {
                    console.error("❌ Gagal verifikasi akun:", err);
                    return res.send(`
                        <html>
                        <head>
                            <script src="https://cdn.tailwindcss.com"></script>
                        </head>
                        <body class="flex justify-center items-center h-screen bg-gradient-to-br from-gray-900 via-blue-800 to-blue-500">
                            <div class="bg-white/20 backdrop-blur-md p-6 rounded-lg shadow-lg text-center max-w-sm border border-white/30">
                                <h2 class="text-red-500 text-lg font-semibold">Verifikasi Gagal, silahkan coba daftar lagi</h2>
                                <p class="mt-2 text-gray-100">Terjadi kesalahan saat verifikasi akun.</p>
                            </div>
                        </body>
                        </html>
                    `);
                }
                res.send(`
                    <html>
                    <head>
                        <script src="https://cdn.tailwindcss.com"></script>
                    </head>
                    <body class="flex justify-center items-center h-screen bg-gradient-to-br from-gray-900 via-blue-800 to-blue-500">
                        <div class="bg-white/20 backdrop-blur-md p-6 rounded-lg shadow-lg text-center max-w-sm border border-white/30">
                            <h2 class="text-white text-lg font-semibold">Verifikasi Berhasil!</h2>
                            <p class="mt-2 text-gray-200">Silakan login untuk melanjutkan.</p>
                        </div>
                    </body>
                    </html>
                `);
            }
        );
    });
});

// **LOGIN USER**
router.post('/login', (req, res) => {
    console.log("🔹 Login route hit");
    console.log("📥 Request Body:", req.body);

    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username dan password harus diisi' });
    }

    // 🔹 Cari user dan member_id dalam satu query
    const query = `
        SELECT users.*, members.id AS member_id
        FROM users
        LEFT JOIN members ON users.id = members.user_id
        WHERE users.username = ?
    `;

    db.query(query, [username], async (err, results) => {
        if (err || results.length === 0) {
            console.error("❌ Username atau password salah");
            return res.status(401).json({ message: 'Username atau password salah' });
        }

        const user = results[0];

        if (user.is_verified === 0) {
            console.warn("⚠️ Akun belum diverifikasi");
            return res.status(403).json({ message: 'Akun belum diverifikasi. Cek email!' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.error("❌ Password tidak cocok");
            return res.status(401).json({ message: 'Username atau password salah' });
        }

        // 🔹 Tambahkan `member_id` ke dalam token JWT
        const token = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                role: user.role, 
                is_verified: user.is_verified, 
                member_id: user.member_id,
                no_identitas: user.no_identitas
            }, 
            process.env.JWT_SECRET, 
            { expiresIn: '1h' }
        );

        console.log("✅ Login berhasil untuk user:", username);
        res.json({ message: 'Login berhasil', token });
    });
});

//=========================================
// RESET PASSWORD
//=========================================

// **RESET PASSWORD**
router.post('/reset-password', async (req, res) => {
    console.log("🔹 Reset password route hit");
    console.log("📥 Request Body:", req.body);

    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
        return res.status(400).json({ message: 'Email dan password baru harus diisi' });
    }

    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err || results.length === 0) {
            console.error("❌ Email tidak ditemukan");
            return res.status(404).json({ message: 'Email tidak ditemukan' });
        }

        const user = results[0];
        const resetToken = uuidv4();
        const resetTokenExpiry = Date.now() + 3600000; // 1 jam dari sekarang

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        db.query(
            'UPDATE users SET reset_token = ?, reset_token_expiry = ?, password = ? WHERE id = ?',
            [resetToken, resetTokenExpiry, hashedPassword, user.id],
            async (err) => {
                if (err) {
                    console.error("❌ Gagal menyimpan token reset:", err);
                    return res.status(500).json({ message: 'Gagal menyimpan token reset', error: err });
                }

                try {
                    await transporter.sendMail({
                        from: process.env.SMTP_EMAIL,
                        to: email,
                        subject: 'Verifikasi Reset Password ICCN',
                        html: `<p>Klik <a href="${process.env.BASE_URL}/auth/verify-reset-password?token=${resetToken}">di sini</a> untuk verifikasi reset password.</p>`
                    });

                    res.status(200).json({ message: 'Email verifikasi reset password telah dikirim. Silakan cek email Anda.' });
                } catch (error) {
                    console.error("❌ Gagal mengirim email:", error);
                    res.status(500).json({ message: 'Gagal mengirim email verifikasi', error });
                }
            }
        );
    });
});

// **VERIFIKASI RESET PASSWORD**
router.get('/verify-reset-password', (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).json({ message: 'Token tidak valid' });
    }

    db.query('SELECT * FROM users WHERE reset_token = ? AND reset_token_expiry > ?', [token, Date.now()], (err, results) => {
        if (err || results.length === 0) {
            console.error("❌ Token reset tidak valid atau kadaluarsa");
            return res.status(400).json({ message: 'Token reset tidak valid atau kadaluarsa' });
        }

        db.query(
            'UPDATE users SET reset_token = NULL, reset_token_expiry = NULL WHERE reset_token = ?',
            [token],
            (err) => {
                if (err) {
                    console.error("❌ Gagal verifikasi reset password:", err);
                    return res.status(500).json({ message: 'Gagal verifikasi reset password', error: err });
                }

                res.send(`
                    <html>
                    <head>
                        <script src="https://cdn.tailwindcss.com"></script>
                    </head>
                    <body class="flex justify-center items-center h-screen bg-gradient-to-br from-gray-900 via-blue-800 to-blue-500">
                        <div class="bg-white/20 backdrop-blur-md p-6 rounded-lg shadow-lg text-center max-w-sm border border-white/30">
                            <h2 class="text-white text-lg font-semibold">Reset Password Berhasil!</h2>
                            <p class="mt-2 text-gray-200">Silakan login untuk melanjutkan.</p>
                        </div>
                    </body>
                    </html>
                `);
            }
        );
    });
});







module.exports = router;
