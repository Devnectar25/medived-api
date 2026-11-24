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
let lastSettingsFetchTime = 0;
const SETTINGS_CACHE_TTL_MS = 60 * 1000; // 60-second in-memory cache to eliminate repeated DB hits during checkout

// The table and columns come from migrations/20261103_create_store_settings_and_product_gst.sql.
// They must not be created here: ALTER TABLE on orders/products needs an exclusive lock, and
// running it while checkouts are open blocks every reader of those tables.

let refreshing = null;
exports.getSettings = async (forceRefresh = false) => {
    const now = Date.now();
    if (!forceRefresh && lastSettingsFetchTime && (now - lastSettingsFetchTime < SETTINGS_CACHE_TTL_MS)) {
        return inMemorySettings;
    }

    // Concurrent requests share one refresh instead of each querying the database
    if (!refreshing) {
        refreshing = loadSettings().finally(() => { refreshing = null; });
    }
    return refreshing;
};

const loadSettings = async () => {
    const now = Date.now();
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
            lastSettingsFetchTime = now;
            return inMemorySettings;
        }

        // Initialize default row if not present
        await pool.query(
            `INSERT INTO store_settings (key, value, updated_at) 
             VALUES ('store_config', $1::jsonb, NOW())
             ON CONFLICT (key) DO NOTHING`,
            [JSON.stringify(DEFAULT_SETTINGS)]
        );
        lastSettingsFetchTime = now;
        return inMemorySettings;
    } catch (error) {
        console.error('[settingsService] Error fetching store_settings, falling back to cache:', error.message);
        return inMemorySettings;
    }
};

exports.updateSettings = async (newConfig) => {
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
        lastSettingsFetchTime = Date.now();
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
