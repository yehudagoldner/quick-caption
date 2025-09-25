import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function fixEncoding() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  console.log('🔧 Fixing filename encoding...\n');

  // Get all videos with potentially garbled filenames
  const [videos] = await connection.execute(
    'SELECT id, original_filename FROM videos WHERE original_filename LIKE "%×%"'
  );

  console.log(`Found ${videos.length} videos with encoding issues\n`);

  if (videos.length === 0) {
    console.log('✅ No encoding issues found!');
    await connection.end();
    return;
  }

  for (const video of videos) {
    try {
      // Convert the garbled text back to proper UTF-8
      // The issue is that Hebrew was stored as UTF-8 bytes interpreted as Latin-1
      const buffer = Buffer.from(video.original_filename, 'latin1');
      const fixed = buffer.toString('utf8');

      console.log(`Video ID ${video.id}:`);
      console.log(`  Before: ${video.original_filename}`);
      console.log(`  After:  ${fixed}`);

      // Update the database
      await connection.execute(
        'UPDATE videos SET original_filename = ? WHERE id = ?',
        [fixed, video.id]
      );

      console.log('  ✅ Fixed!\n');
    } catch (error) {
      console.error(`  ❌ Error fixing video ${video.id}:`, error.message, '\n');
    }
  }

  await connection.end();
  console.log('✅ Encoding fix complete!');
}

fixEncoding().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});