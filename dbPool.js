const mysql = require('mysql2/promise'); // <-- Gunakan mysql2/promise
require('dotenv').config();

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Tes koneksi
db.getConnection()
    .then(connection => {
        console.log('✅ Database Pool Connected');
        connection.release(); // Lepaskan koneksi kembali ke pool
    })
    .catch(err => {
        console.error('❌ Error pool connecting to database:', err);
    });

module.exports = db; // <-- Ekspor db langsung, tanpa .promise()