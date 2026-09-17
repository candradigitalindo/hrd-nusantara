// Dijalankan Jest sebelum modul aplikasi di-import.
// dotenv tidak menimpa variabel yang sudah ada, jadi nilai dari .env.test
// yang dimuat di sini akan menang atas .env yang dibaca src/config/env.ts.
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });
