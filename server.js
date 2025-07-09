require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const router = express.Router();
const listEndpoints = require('express-list-endpoints');

const authRoutes = require('./routes/auth');
const memberRoutes = require('./routes/members');
const adminRoutes = require('./routes/admin');
const beritaRoutes = require('./routes/berita');
const organisasiRoutes = require('./routes/organisasi');
const pelatihanRoutes = require('./routes/pelatihan');
const servicesRoutes = require('./routes/services');

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json()); // HARUS di atas route

// Koneksi MySQL
// Koneksi MySQL
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 60000,
    acquireTimeout: 60000,
});

// Tes koneksi dan setup ping connection
db.getConnection()
    .then(connection => {
        console.log('✅ Database Pool Connected');
        connection.release();

        // Ping connection setiap 5 menit supaya koneksi tetap hidup
        setInterval(async () => {
            try {
                await db.query('SELECT 1');
                // console.log('Ping sukses');
            } catch (err) {
                console.error('Keep-alive error, reconnecting...: ', err);
            }
        }, 5 * 60 * 1000);
    })
    .catch(err => {
        console.error('❌ Error pool connecting to database:', err);
    });

// Ping connection untuk memastikan server tetap hidup
app.get('/ping', (req, res) => {
  res.send('pong');
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
app.get('/users', async (req, res) => {
    try {
        const [results] = await db.query('SELECT * FROM users');
        res.json(results);
    } catch (err) {
        console.error('❌ Error fetching users:', err);
        res.status(500).json({ message: 'Gagal mengambil data users' });
    }
});

// iki gawe akses upload
app.use('/uploads', express.static('uploads'));
console.log(listEndpoints(app));
