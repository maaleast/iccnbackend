const express = require('express');
const db = require('../dbPool'); // Koneksi database
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
            const tipeKeanggotaan = req.body.userType ? req.body.userType.toLowerCase().replace(/\s+/g, '_') : 'default';
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

    try {
        await db.query(
            'INSERT INTO users (username, email, password, verification_token, is_verified, role) VALUES (?, ?, ?, ?, ?, ?)',
            [username, email, hashedPassword, verificationToken, false, null]
        );

        await transporter.sendMail({
            from: process.env.SMTP_EMAIL,
            to: email,
            subject: 'Verifikasi Akun ICCN',
            html: `<p>Klik <a href="${process.env.BASE_URL}/auth/verify?token=${verificationToken}">di sini</a> untuk verifikasi akun.</p>`
        });

        res.status(201).json({ message: 'Registrasi berhasil! Cek email untuk verifikasi' });
    } catch (err) {
    console.error("❌ Error saat registrasi:", err);
        res.status(500).json({ message: 'Error saat registrasi', error: err });
    }
});

// 📌 REGISTER MEMBER
router.post(
  "/register-member",
  upload.fields([{ name: "file_sk" }, { name: "bukti_pembayaran" }, { name: "logo" }]),
  async (req, res) => {
    console.time("⏱️ Total waktu proses register-member");

    let connection;
    try {
      const {
        username, email, password, userType, institutionName, websiteLink, address,
        region, personalName, transferAmount, whatsappGroupNumber, receiptName
      } = req.body;

      let { additional_members_info } = req.body;

      if (!username || !email || !password || !userType || !transferAmount) {
        return res.status(400).json({ message: "Semua field wajib diisi!" });
      }

      // Validasi email & WA number
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Format email tidak valid!" });
      }

      const waRegex = /^[0-9]+$/;
      if (whatsappGroupNumber && !waRegex.test(whatsappGroupNumber)) {
        return res.status(400).json({ message: "Nomor WA hanya boleh berisi angka!" });
      }

      // Cek email sudah ada atau belum
      connection = await db.getConnection();
      const [existingUsers] = await connection.query("SELECT id FROM users WHERE email = ?", [email]);
      if (existingUsers.length > 0) {
        connection.release();
        return res.status(400).json({ message: "Email sudah terdaftar!" });
      }

      if (!req.files || !req.files["file_sk"] || !req.files["bukti_pembayaran"]) {
        connection.release();
        return res.status(400).json({ message: "File SK dan Bukti Pembayaran harus diunggah!" });
      }

      // Hash password & buat verification token
      const hashedPassword = await bcrypt.hash(password, 10);
      const verificationToken = uuidv4();

      // Simpan file path
      const fileSkPath = `/uploads/file_sk/${req.files["file_sk"][0].filename}`;
      const buktiPembayaranPath = `/uploads/bukti_pembayaran/${req.files["bukti_pembayaran"][0].filename}`;
      let logoPath = null;
      if (req.files["logo"]) {
        const userTypeDir = userType.toLowerCase().replace(/\s+/g, "_");
        logoPath = `/uploads/${userTypeDir}/logo/${req.files["logo"][0].filename}`;
      }

      if (!additional_members_info || additional_members_info.trim() === "") {
          additional_members_info = null;
        } else {
            additional_members_info = additional_members_info;
      }


      // Generate no_identitas (gunakan connection yang sama)
      async function generateUniqueIdentitasWithConn(userType) {
        const tahun = new Date().getFullYear() % 100;
        const prefixMap = { Universitas: "UI", Perusahaan: "PR", Individu: "IN", Mahasiswa: "MA" };
        const prefix = prefixMap[userType];

        if (!prefix) throw new Error("Tipe keanggotaan tidak valid!");

        const [rows] = await connection.query(
          `SELECT MAX(CAST(SUBSTRING(no_identitas, 6, 3) AS UNSIGNED)) AS maxCounter 
           FROM members 
           WHERE no_identitas LIKE ?`,
          [`${tahun}.${prefix}%`]
        );

        const counter = (rows[0]?.maxCounter || 0) + 1;
        return `${tahun}.${prefix}${String(counter).padStart(3, '0')}.01`;
      }

      const no_identitas = await generateUniqueIdentitasWithConn(userType);

      const idAkhir = no_identitas.slice(-2);
      const namaGenerasi = {
        [idAkhir]: {
          name: personalName,
          timestamp: new Date().toISOString(),
        },
      };

      const tanggalSubmit = new Date();
      const masaAktif = new Date(tanggalSubmit);
      masaAktif.setFullYear(masaAktif.getFullYear() + 1);
      const masaAktifFormatted = masaAktif.toISOString().split("T")[0];

      // Mulai transaksi
      await connection.beginTransaction();

      const [userResult] = await connection.query(
        "INSERT INTO users (username, email, password, verification_token, is_verified, role) VALUES (?, ?, ?, ?, ?, ?)",
        [username, email, hashedPassword, verificationToken, false, "member"]
      );

      const user_id = userResult.insertId;

      await connection.query(
        `INSERT INTO members (
          user_id, no_identitas, tipe_keanggotaan, institusi, website, email, alamat, wilayah, nama, nominal_transfer,
          nomor_wa, nama_kuitansi, additional_members_info, file_sk, bukti_pembayaran, logo, status_verifikasi,
          tanggal_submit, masa_aktif, badge, nama_generasi
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW(), ?, ?, ?)`,
        [
          user_id, no_identitas, userType, institutionName, websiteLink, email, address, region, personalName,
          transferAmount, whatsappGroupNumber, receiptName, additional_members_info,
          fileSkPath, buktiPembayaranPath, logoPath, masaAktifFormatted, "{}", JSON.stringify(namaGenerasi),
        ]
      );

      const deskripsi = `Pendaftaran Member dari ${no_identitas}, dengan nama ${personalName}, Nama kuitansinya ${receiptName}`;
      await connection.query(
        "INSERT INTO admin_laporan_keuangan (status, jumlah, deskripsi, tanggal_waktu) VALUES (?, ?, ?, NOW())",
        ["MASUK", transferAmount, deskripsi]
      );

      // Commit transaksi
      await connection.commit();

      // Kirim email verifikasi (tidak perlu connection)
      await transporter.sendMail({
        from: process.env.SMTP_EMAIL,
        to: email,
        subject: "Verifikasi Akun ICCN",
        html: `<p>Terima kasih telah mendaftar sebagai member ICCN. Klik <a href="${process.env.BASE_URL}/auth/verify?token=${verificationToken}">di sini</a> untuk verifikasi akun Anda.</p>`,
      });

      connection.release();

      console.timeEnd("⏱️ Total waktu proses register-member");

      return res.status(201).json({
        message: "Pendaftaran member berhasil! Silakan cek email untuk verifikasi.",
        file_sk: fileSkPath,
        bukti_pembayaran: buktiPembayaranPath,
        logo: logoPath,
        masa_aktif: masaAktifFormatted,
        no_identitas: no_identitas,
      });

    } catch (error) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      console.error("❌ Error saat registrasi:", error);
      console.timeEnd("⏱️ Total waktu proses register-member");
      return res.status(500).json({ message: "Gagal mendaftar", error });
    }
  }
); 

// **VERIFIKASI EMAIL**
router.get('/verify', async (req, res) => {
    console.log("🔹 Verify route hit");

    const { token } = req.query;
    if (!token) {
        return res.status(400).json({ message: 'Token tidak valid' });
    }

    try {
        const [results] = await db.query('SELECT * FROM users WHERE verification_token = ?', [token]);

        if (results.length === 0) {
            console.error("❌ Token verifikasi tidak ditemukan");
            return res.status(400).json({ message: 'Token verifikasi tidak valid' });
        }

        await db.query('UPDATE users SET is_verified = TRUE, verification_token = NULL WHERE verification_token = ?', [token]);

        return res.send(`
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
    } catch (err) {
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
});

// **LOGIN USER**
router.post('/login', async (req, res) => {
    console.log("🔹 Login route hit");
    console.log("📥 Request Body:", req.body);

    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username dan password harus diisi' });
    }

    try {
        const [rows] = await db.query(
            `SELECT id, username, role, is_verified, password FROM users WHERE username = ?`, 
            [username]
        );

        if (rows.length === 0) {
            console.warn("❌ Username tidak ditemukan");
            return res.status(401).json({ message: 'Username atau password salah' });
        }

        const user = rows[0];

        if (!user.password) {
            console.warn("❌ User tidak memiliki password");
            return res.status(500).json({ message: 'Password tidak tersedia untuk akun ini' });
        }

        if (user.is_verified === 0) {
            console.warn("⚠️ Akun belum diverifikasi");
            return res.status(403).json({ message: 'Akun belum diverifikasi. Cek email!' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.warn("❌ Password tidak cocok");
            return res.status(401).json({ message: 'Username atau password salah' });
        }

        const token = jwt.sign(
            {
                id: user.id,
                role: user.role,
                is_verified: user.is_verified
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        console.log("✅ Login berhasil untuk user:", username);
        return res.json({ message: 'Login berhasil', token });

    } catch (err) {
        console.error("❌ Error saat login:", err);
        return res.status(500).json({ message: 'Terjadi kesalahan pada server' });
    }
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

    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

        if (users.length === 0) {
            console.error("❌ Email tidak ditemukan");
            return res.status(404).json({ message: 'Email tidak ditemukan' });
        }

        const user = users[0];
        const resetToken = uuidv4();
        const resetTokenExpiry = Date.now() + 3600000; // 1 jam

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await db.query(
            'UPDATE users SET reset_token = ?, reset_token_expiry = ?, password = ? WHERE id = ?',
            [resetToken, resetTokenExpiry, hashedPassword, user.id]
        );

        await transporter.sendMail({
            from: process.env.SMTP_EMAIL,
            to: email,
            subject: 'Verifikasi Reset Password ICCN',
            html: `<p>Klik <a href="${process.env.BASE_URL}/auth/verify-reset-password?token=${resetToken}">di sini</a> untuk verifikasi reset password.</p>`
        });

        console.log("✅ Email reset password terkirim ke:", email);
        res.status(200).json({ message: 'Email verifikasi reset password telah dikirim. Silakan cek email Anda.' });

    } catch (error) {
        console.error("❌ Error saat reset password:", error);
        res.status(500).json({ message: 'Terjadi kesalahan saat reset password', error });
    }
});

// **VERIFIKASI RESET PASSWORD**
router.get('/verify-reset-password', async (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).json({ message: 'Token tidak valid' });
    }

    try {
        const [users] = await db.query(
            'SELECT * FROM users WHERE reset_token = ? AND reset_token_expiry > ?',
            [token, Date.now()]
        );

        if (users.length === 0) {
            console.error("❌ Token reset tidak valid atau kadaluarsa");
            return res.status(400).json({ message: 'Token reset tidak valid atau kadaluarsa' });
        }

        await db.query(
            'UPDATE users SET reset_token = NULL, reset_token_expiry = NULL WHERE reset_token = ?',
            [token]
        );

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

    } catch (err) {
        console.error("❌ Gagal verifikasi reset password:", err);
        res.status(500).json({ message: 'Gagal verifikasi reset password', error: err });
    }
});

module.exports = router;
