/**
 * Initialize Chatbot Database Schema
 * Run this script to set up the chatbot tables and seed initial knowledge base
 */

const pool = require('../config/db');
const fs = require('fs');
const path = require('path');

async function initializeChatbotDatabase() {
    const client = await pool.connect();

    try {
        console.log('🤖 Initializing Chatbot Database...\n');

        // Read SQL file
        const sqlFilePath = path.join(__dirname, '../sql/chatbot_schema.sql');
        const sql = fs.readFileSync(sqlFilePath, 'utf8');

        console.log('📝 Executing schema and seed data...');

        // Execute the SQL
        await client.query(sql);

        console.log('✅ Chatbot database initialized successfully!\n');

        // Verify tables
        const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE 'chatbot%'
            ORDER BY table_name
        `);

        console.log('📊 Created tables:');
        tablesResult.rows.forEach(row => {
            console.log(`   - ${row.table_name}`);
        });

        // Count knowledge entries
        const countResult = await client.query('SELECT COUNT(*) FROM chatbot_knowledge');
        console.log(`\n💡 Seeded ${countResult.rows[0].count} knowledge base entries`);

        console.log('\n🎉 Chatbot NLP system is ready to use!');
        console.log('\n📚 Next steps:');
        console.log('   1. Start the API server: npm run dev');
        console.log('   2. Test chatbot endpoint: POST /api/chatbot/query');
        console.log('   3. Access admin panel to manage knowledge base');
        console.log('   4. Monitor unanswered queries for auto-learning\n');

    } catch (error) {
        console.error('❌ Error initializing chatbot database:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Run if called directly
if (require.main === module) {
    initializeChatbotDatabase()
        .then(() => {
            console.log('Done!');
            process.exit(0);
        })
        .catch(error => {
            console.error('Failed:', error);
            process.exit(1);
        });
}

module.exports = initializeChatbotDatabase;
