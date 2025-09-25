import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function checkDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  console.log('🔍 Checking database structure...\n');

  // Check tables exist
  const [tables] = await connection.execute(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('users', 'videos')",
    [process.env.DB_NAME]
  );
  console.log('✅ Tables found:', tables.map(t => t.TABLE_NAME).join(', '));

  // Check videos table structure
  const [columns] = await connection.execute(
    "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'videos' ORDER BY ORDINAL_POSITION",
    [process.env.DB_NAME]
  );

  console.log('\n📋 Videos table structure:');
  columns.forEach(col => {
    console.log(`  - ${col.COLUMN_NAME}: ${col.DATA_TYPE}${col.CHARACTER_SET_NAME ? ` (${col.CHARACTER_SET_NAME})` : ''}`);
  });

  // Check for UTF-8 encoding
  const [tableInfo] = await connection.execute(
    "SELECT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'videos'",
    [process.env.DB_NAME]
  );
  console.log('\n🔤 Table collation:', tableInfo[0].TABLE_COLLATION);

  // Count videos
  const [counts] = await connection.execute('SELECT COUNT(*) as total, SUM(stored_path IS NOT NULL) as with_storage FROM videos');
  console.log('\n📊 Video statistics:');
  console.log(`  - Total videos: ${counts[0].total}`);
  console.log(`  - Videos with stored files: ${counts[0].with_storage || 0}`);
  console.log(`  - Videos without stored files: ${counts[0].total - (counts[0].with_storage || 0)}`);

  // Sample data check
  const [sample] = await connection.execute('SELECT id, original_filename, stored_path, HEX(original_filename) as hex_filename FROM videos LIMIT 1');
  if (sample.length > 0) {
    console.log('\n📄 Sample video data:');
    console.log(`  - ID: ${sample[0].id}`);
    console.log(`  - Filename: ${sample[0].original_filename}`);
    console.log(`  - Hex: ${sample[0].hex_filename}`);
    console.log(`  - Stored path: ${sample[0].stored_path || 'NULL'}`);
  }

  // Check if mime_type column exists
  const hasMimeType = columns.some(col => col.COLUMN_NAME === 'mime_type');
  console.log('\n🔧 Recommendations:');

  if (!hasMimeType) {
    console.log('  ⚠️  Consider adding mime_type column for better file serving');
  }

  const videosWithoutStorage = counts[0].total - (counts[0].with_storage || 0);
  if (videosWithoutStorage > 0) {
    console.log(`  ⚠️  ${videosWithoutStorage} videos don't have stored files (uploaded before storage feature)`);
  }

  if (tableInfo[0].TABLE_COLLATION !== 'utf8mb4_unicode_ci') {
    console.log('  ⚠️  Table collation is not utf8mb4_unicode_ci');
  }

  await connection.end();
  console.log('\n✅ Database check complete!');
}

checkDatabase().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});