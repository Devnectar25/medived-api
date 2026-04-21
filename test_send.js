const pool = require('./src/config/db');
const { sendCampaign } = require('./src/controllers/campaignController');

async function test() {
    try {
        const result = await pool.query(`SELECT id FROM whatsapp_campaigns ORDER BY created_at DESC LIMIT 1`);
        if(result.rows.length === 0) { console.log('No campaigns'); return; }
        const id = result.rows[0].id;
        console.log('Sending for campaign:', id);

        const req = { params: { id } };
        const res = {
            status: (code) => ({ json: (data) => console.log('STATUS:', code, data) }),
            json: (data) => console.log('JSON:', data)
        };
        await sendCampaign(req, res);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
test();
