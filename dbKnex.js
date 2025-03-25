require("dotenv").config();
const knex = require("knex")({
    client: "mysql2",
    connection: {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: 3306
    },
    pool: { min: 2, max: 10 }
});

// Fungsi untuk mengecek status koneksi database
async function getConnection() {
    try {
        await knex.raw("SELECT 1");
        console.log("✅ Database knex connected successfully!");
    } catch (error) {
        console.error("❌ Database knex connection failed:", error.message);
    }
}

// Panggil fungsi untuk cek koneksi saat startup
getConnection();

module.exports = knex;
