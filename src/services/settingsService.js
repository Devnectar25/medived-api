const pool = require('../config/db');

const DEFAULT_SETTINGS = {
    gst: {
        enabled: false,
        defaultRate: 18,
        inclusive: false
    },
    cardSurcharge: {
        enabled: false,
        rate: 2.0
    },
    codCharge: {
        enabled: true,
        amount: 100
    },
    storefront: {
        storeTitle: "HomVed",
        supportEmail: "support@homved.com",
        freeShippingThreshold: 499,
        currencySymbol: "₹",
        maintenanceMode: false
    }
};

let inMemorySettings = { ...DEFAULT_SETTINGS };
let hasInitializedTable = false;

const ensureTableExists = async () => {
    if (hasInitializedTable) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS store_settings (
                id SERIAL PRIMARY KEY,
                key VARCHAR(100) UNIQUE NOT NULL,
                value JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(10, 2) DEFAULT 0;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS card_surcharge NUMERIC(10, 2) DEFAULT 0;
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS cod_charge NUMERIC(10, 2) DEFAULT 0;
            ALTER TABLE products ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5, 2) DEFAULT 0;
        `);
        hasInitializedTable = true;
    } catch (err) {
        console.warn('[settingsService] Failed to ensure store_settings table:', err.message);
    }
};

exports.getSettings = async () => {
    await ensureTableExists();
    try {
        const result = await pool.query(`SELECT key, value FROM store_settings WHERE key = 'store_config'`);
        if (result.rows.length > 0 && result.rows[0].value) {
            inMemorySettings = {
                ...DEFAULT_SETTINGS,
                ...result.rows[0].value,
                gst: { ...DEFAULT_SETTINGS.gst, ...(result.rows[0].value.gst || {}) },
                cardSurcharge: { ...DEFAULT_SETTINGS.cardSurcharge, ...(result.rows[0].value.cardSurcharge || {}) },
                codCharge: { ...DEFAULT_SETTINGS.codCharge, ...(result.rows[0].value.codCharge || {}) },
                storefront: { ...DEFAULT_SETTINGS.storefront, ...(result.rows[0].value.storefront || {}) }
            };
            return inMemorySettings;
        }

        // Initialize default row if not present
        await pool.query(
            `INSERT INTO store_settings (key, value, updated_at) 
             VALUES ('store_config', $1::jsonb, NOW())
             ON CONFLICT (key) DO NOTHING`,
            [JSON.stringify(DEFAULT_SETTINGS)]
        );
        return inMemorySettings;
    } catch (error) {
        console.error('[settingsService] Error fetching store_settings, falling back to cache:', error.message);
        return inMemorySettings;
    }
};

exports.updateSettings = async (newConfig) => {
    await ensureTableExists();
    try {
        const current = await exports.getSettings();
        const merged = {
            ...current,
            ...newConfig,
            gst: { ...current.gst, ...(newConfig.gst || {}) },
            cardSurcharge: { ...current.cardSurcharge, ...(newConfig.cardSurcharge || {}) },
            codCharge: { ...current.codCharge, ...(newConfig.codCharge || {}) },
            storefront: { ...current.storefront, ...(newConfig.storefront || {}) }
        };

        await pool.query(
            `INSERT INTO store_settings (key, value, updated_at)
             VALUES ('store_config', $1::jsonb, NOW())
             ON CONFLICT (key)
             DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
            [JSON.stringify(merged)]
        );

        inMemorySettings = merged;
        return inMemorySettings;
    } catch (error) {
        console.error('[settingsService] Error updating store_settings:', error.message);
        // Still update in-memory cache
        inMemorySettings = {
            ...inMemorySettings,
            ...newConfig,
            gst: { ...inMemorySettings.gst, ...(newConfig.gst || {}) },
            cardSurcharge: { ...inMemorySettings.cardSurcharge, ...(newConfig.cardSurcharge || {}) },
            codCharge: { ...inMemorySettings.codCharge, ...(newConfig.codCharge || {}) },
            storefront: { ...inMemorySettings.storefront, ...(newConfig.storefront || {}) }
        };
        return inMemorySettings;
    }
};
