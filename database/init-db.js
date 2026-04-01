/**
 * تهيئة قاعدة البيانات
 * تشغيل هذا السكريبت لإنشاء الجداول والـ Views
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool(config.database);

async function initDatabase() {
  console.log('🔧 جاري تهيئة قاعدة البيانات...\n');
  
  try {
    // قراءة ملف Schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // تنفيذ Schema (تجاهل أخطاء "already exists")
    try {
      await pool.query(schema);
    } catch (queryErr) {
      // تجاهل فقط أخطاء "already exists"
      if (queryErr.message && queryErr.message.includes('already exists')) {
        console.log('⚠️  بعض الكائنات موجودة مسبقاً - تم التجاوز');
      } else {
        // رمي أخطاء أخرى
        throw queryErr;
      }
    }
    
    console.log('✅ تم إنشاء الجداول بنجاح!\n');
    
    // عرض الجداول المُنشأة
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log('📊 الجداول المُنشأة:');
    result.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. ${row.table_name}`);
    });
    
    console.log('\n✅ تمت التهيئة بنجاح!');
    
  } catch (err) {
    console.error('❌ خطأ في تهيئة قاعدة البيانات:', err.message);
    throw err; // رمي الخطأ بدل exit
  } finally {
    await pool.end();
  }
}

// تشغيل التهيئة
initDatabase();
