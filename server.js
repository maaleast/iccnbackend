require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const router = express.Router();

const authRoutes = require('./routes/auth');
const memberRoutes = require('./routes/members');
const adminRoutes = require('./routes/admin');
const beritaRoutes = require('./routes/berita');
const organisasiRoutes = require('./routes/organisasi');
const pelatihanRoutes = require('./routes/pelatihan');
const servicesRoutes = require('./routes/services');

const app = express();
const port = process.env.PORT || 5050;

// Middleware
app.use(cors());
app.use(express.json()); // HARUS di atas route

// Koneksi MySQL
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect(err => {
    if (err) {
        console.error('❌ Database connection error:', err);
    } else {
        console.log('✅ Database Connected');
    }
});

// **ROUTE UTAMA**
app.get('/', (req, res) => {
    res.send('API is working on http://localhost:' + port);
});

// **ROUTES**
app.use('/auth', authRoutes);
app.use('/members', memberRoutes);
app.use('/admin', adminRoutes);
app.use('/berita', beritaRoutes);
app.use('/organisasi', organisasiRoutes);
app.use('/pelatihan', pelatihanRoutes);
app.use('/services', servicesRoutes);

// Jalankan server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

// **GET ALL USERS for member dashboard
app.get('/users', (req, res) => {
    db.query('SELECT * FROM users', (err, results) => {
        if (err) {
            console.error('❌ Error fetching users:', err);
            return res.status(500).json({ message: 'Gagal mengambil data users' });
        }
        res.json(results);
    });
});

// iki gawe akses upload
app.use('/uploads', express.static('uploads'));


