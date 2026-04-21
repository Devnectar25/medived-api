const pool = require('../config/db');
const { sendCampaignMessage } = require('../services/whatsappService');

exports.getPublicCampaign = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`SELECT * FROM whatsapp_campaigns WHERE id = $1`, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Campaign not found' });
        }
        res.json({ success: true, campaign: result.rows[0] });
    } catch (error) {
        console.error('Error fetching public campaign:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getCampaigns = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*, cp.product_id,
                COALESCE(
                    (SELECT array_agg(wca.user_id) 
                     FROM whatsapp_campaign_audience wca 
                     WHERE wca.campaign_id = c.id), 
                    '{}'
                ) as users
            FROM whatsapp_campaigns c 
            LEFT JOIN whatsapp_campaign_products cp ON c.id = cp.campaign_id 
            ORDER BY c.created_at DESC
        `);
        res.json({ success: true, campaigns: result.rows });
    } catch (error) {
        console.error('Error fetching campaigns:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.createCampaign = async (req, res) => {
    try {
        const { title, festival_message, offer_details, image_url, discount_type, discount_value, users, product_id } = req.body;
        
        // 1. Insert Campaign
        const insertRes = await pool.query(
            `INSERT INTO whatsapp_campaigns (title, festival_message, offer_details, image_url, discount_type, discount_value) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [title, festival_message, offer_details, image_url, discount_type, discount_value || 0]
        );
        const campaignId = insertRes.rows[0].id;

        // 2. Insert selected users into audience table
        if (users && users.length > 0) {
            for (let userId of users) {
                await pool.query(
                    `INSERT INTO whatsapp_campaign_audience (campaign_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [campaignId, userId]
                );
            }
        }

        // 3. Insert specific product if selected
        if (product_id) {
            await pool.query(
                `INSERT INTO whatsapp_campaign_products (campaign_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [campaignId, product_id]
            );
        }

        res.json({ success: true, campaign: insertRes.rows[0] });
    } catch (error) {
        console.error('Error creating campaign:', error);
        res.status(500).json({ success: false, message: 'Failed to create campaign' });
    }
};

exports.updateCampaign = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, festival_message, offer_details, image_url, discount_type, discount_value, users, product_id } = req.body;
        
        // 1. Update Campaign Details
        const updateRes = await pool.query(
            `UPDATE whatsapp_campaigns 
             SET title = $1, festival_message = $2, offer_details = $3, image_url = $4, discount_type = $5, discount_value = $6
             WHERE id = $7 RETURNING *`,
            [title, festival_message, offer_details, image_url, discount_type, discount_value || 0, id]
        );

        if (updateRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Campaign not found' });
        }

        // 2. Re-insert target users
        await pool.query(`DELETE FROM whatsapp_campaign_audience WHERE campaign_id = $1`, [id]);
        if (users && users.length > 0) {
            for (let userId of users) {
                await pool.query(
                    `INSERT INTO whatsapp_campaign_audience (campaign_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [id, userId]
                );
            }
        }

        // 3. Re-insert target product
        await pool.query(`DELETE FROM whatsapp_campaign_products WHERE campaign_id = $1`, [id]);
        if (product_id) {
            await pool.query(
                `INSERT INTO whatsapp_campaign_products (campaign_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [id, product_id]
            );
        }

        res.json({ success: true, campaign: updateRes.rows[0] });
    } catch (error) {
        console.error('Error updating campaign:', error);
        res.status(500).json({ success: false, message: 'Failed to update campaign' });
    }
};

exports.toggleCampaignStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        await pool.query(`UPDATE whatsapp_campaigns SET is_active = $1 WHERE id = $2`, [is_active, id]);
        res.json({ success: true, message: 'Campaign status updated' });
    } catch (error) {
        console.error('Error toggling campaign status:', error);
        res.status(500).json({ success: false, message: 'Server error check' });
    }
};

exports.deleteCampaign = async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query(`DELETE FROM whatsapp_campaigns WHERE id = $1`, [id]);
        res.json({ success: true, message: 'Campaign deleted' });
    } catch (error) {
        console.error('Error deleting campaign:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.sendCampaign = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Fetch campaign details
        const campRes = await pool.query(`SELECT * FROM whatsapp_campaigns WHERE id = $1`, [id]);
        if (campRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        const campaign = campRes.rows[0];

        // Fetch users in audience
        const targetRes = await pool.query(`
            SELECT u.username as id, u.contactno as phone, u.emailid as email 
            FROM whatsapp_campaign_audience wca
            JOIN users u ON wca.user_id = u.username
            WHERE wca.campaign_id = $1
        `, [id]);
        const targetUsers = targetRes.rows;

        // Fetch product
        const prodRes = await pool.query(`SELECT product_id FROM whatsapp_campaign_products WHERE campaign_id = $1 LIMIT 1`, [id]);
        let productData = null;
        if (prodRes.rows.length > 0) {
            productData = { id: prodRes.rows[0].product_id };
        }

        let sentCount = 0;
        let failedCount = 0;

        for (let user of targetUsers) {
            if (user.phone) {
                try {
                    await sendCampaignMessage(campaign, user, productData);
                    sentCount++;
                } catch(e) {
                    failedCount++;
                }
            } else {
                failedCount++;
            }
        }

        // Update status to SENT and auto-deactivate
        await pool.query(`UPDATE whatsapp_campaigns SET status = 'SENT', sent_at = NOW(), is_active = false WHERE id = $1`, [id]);

        res.json({ success: true, sentCount, failedCount, message: `Sent to ${sentCount} users.` });
    } catch (error) {
        console.error('Error sending campaign:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
