const express = require('express');
const db = require('../db'); // Koneksi database
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

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

    db.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
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

        // 🔹 Token JWT menyimpan ID, tapi ID tidak dikirim langsung dalam response JSON
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, is_verified: user.is_verified }, 
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
