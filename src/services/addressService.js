const pool = require('../config/db');

const pincodeCache = new Map();

exports.lookupPincode = async (pincode) => {
    const pin = (pincode || '').toString().trim();
    if (!/^\d{6}$/.test(pin)) {
        throw new Error('Valid 6-digit pincode is required');
    }

    if (pincodeCache.has(pin)) {
        return pincodeCache.get(pin);
    }

    const toTitle = (s) => (s || '')
        .toLowerCase()
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
        .trim();

    // 1. Try postalpincode.in with 3s timeout
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data[0]?.Status === 'Success' && Array.isArray(data[0]?.PostOffice) && data[0].PostOffice.length > 0) {
                const po = data[0].PostOffice[0];
                const rawCity = po.District || po.Division || po.Name || '';
                const rawState = po.State || '';
                const result = {
                    city: toTitle(rawCity),
                    state: toTitle(rawState),
                    pincode: pin
                };
                if (result.city && result.state) {
                    pincodeCache.set(pin, result);
                    return result;
                }
            }
        }
    } catch (e) {
        // Fallback
    }

    // 2. Try zippopotam.us with 3s timeout
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`https://api.zippopotam.us/in/${pin}`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data?.places) && data.places.length > 0) {
                const place = data.places[0];
                const rawState = place.state || '';
                const rawCity = place['place name'] || '';
                const result = {
                    city: toTitle(rawCity),
                    state: toTitle(rawState),
                    pincode: pin
                };
                if (result.state) {
                    pincodeCache.set(pin, result);
                    return result;
                }
            }
        }
    } catch (e) {
        // Fallback
    }

    return null;
};

// ── Orders keep their shipping address ─────────────────────────────────────
// Orders point at a user_addresses row (orders.address_id). So that deleting or editing a saved
// address never changes an order's shipping address, a row that an order uses is never deleted or
// overwritten: deleting hides it from the user's list (is_deleted), editing saves a new row.
let deletedColumnReady = null;
const ensureDeletedColumn = () => {
    if (!deletedColumnReady) {
        deletedColumnReady = pool
            .query("ALTER TABLE public.user_addresses ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE")
            .catch((err) => { deletedColumnReady = null; throw err; });
    }
    return deletedColumnReady;
};

exports.ensureDeletedColumn = ensureDeletedColumn;

const isUsedByOrders = async (addressId) => {
    const res = await pool.query("SELECT 1 FROM orders WHERE address_id = $1 LIMIT 1", [addressId]);
    return res.rows.length > 0;
};

exports.getAddressesByUserId = async (userId) => {
    await ensureDeletedColumn();
    const result = await pool.query(
        "SELECT * FROM public.user_addresses WHERE user_id = $1 AND is_deleted = FALSE ORDER BY created_at DESC",
        [userId]
    );
    return result.rows;
};

exports.addAddress = async (data) => {
    const { user_id, address_label, full_address, city, state, postal_code, is_default } = data;

    const cleanCity = (city || '').toString().trim();
    if (!cleanCity || /\d/.test(cleanCity) || !/^[a-zA-Z\s]+$/.test(cleanCity)) {
        throw new Error("City must contain characters only (numbers are not allowed)");
    }

    const cleanState = (state || '').toString().trim();
    if (!cleanState || /\d/.test(cleanState) || !/^[a-zA-Z\s]+$/.test(cleanState)) {
        throw new Error("State must contain characters only (numbers are not allowed)");
    }

    const cleanPostal = (postal_code || '').toString().trim();
    if (!/^\d{6}$/.test(cleanPostal)) {
        throw new Error("Please enter a valid 6-digit pincode");
    }

    // If is_default is true, unset other default addresses for this user
    if (is_default) {
        await pool.query(
            "UPDATE public.user_addresses SET is_default = FALSE WHERE user_id = $1",
            [user_id]
        );
    }

    const result = await pool.query(
        `INSERT INTO public.user_addresses 
        (user_id, address_label, full_address, city, state, postal_code, is_default) 
        VALUES ($1, $2, $3, $4, $5, $6, $7) 
        RETURNING *`,
        [user_id, address_label, full_address, city, state, postal_code, is_default || false]
    );
    return result.rows[0];
};

exports.updateAddress = async (id, data) => {
    const { address_label, full_address, city, state, postal_code, is_default, user_id } = data;

    const cleanCity = (city || '').toString().trim();
    if (!cleanCity || /\d/.test(cleanCity) || !/^[a-zA-Z\s]+$/.test(cleanCity)) {
        throw new Error("City must contain characters only (numbers are not allowed)");
    }

    const cleanState = (state || '').toString().trim();
    if (!cleanState || /\d/.test(cleanState) || !/^[a-zA-Z\s]+$/.test(cleanState)) {
        throw new Error("State must contain characters only (numbers are not allowed)");
    }

    const cleanPostal = (postal_code || '').toString().trim();
    if (!/^\d{6}$/.test(cleanPostal)) {
        throw new Error("Please enter a valid 6-digit pincode");
    }

    if (is_default) {
        await pool.query(
            "UPDATE public.user_addresses SET is_default = FALSE WHERE user_id = $1",
            [user_id]
        );
    }

    await ensureDeletedColumn();

    // Address already used by an order: keep that row as the order's shipping address and save the
    // edit as a new address (the old one is hidden from the user's list).
    if (await isUsedByOrders(id)) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const oldRes = await client.query(
                "UPDATE public.user_addresses SET is_deleted = TRUE, is_default = FALSE WHERE id = $1 RETURNING user_id",
                [id]
            );
            if (oldRes.rows.length === 0) throw new Error('Address not found');
            const inserted = await client.query(
                `INSERT INTO public.user_addresses
                (user_id, address_label, full_address, city, state, postal_code, is_default)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *`,
                [oldRes.rows[0].user_id, address_label, full_address, city, state, postal_code, is_default || false]
            );
            await client.query('COMMIT');
            return inserted.rows[0];
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    const result = await pool.query(
        `UPDATE public.user_addresses
        SET address_label = $1, full_address = $2, city = $3, state = $4, postal_code = $5, is_default = $6
        WHERE id = $7
        RETURNING *`,
        [address_label, full_address, city, state, postal_code, is_default, id]
    );
    return result.rows[0];
};

exports.deleteAddress = async (id) => {
    await ensureDeletedColumn();
    if (await isUsedByOrders(id)) {
        // Orders still ship to / show this address: hide it from the user's list instead of deleting it
        await pool.query("UPDATE public.user_addresses SET is_deleted = TRUE, is_default = FALSE WHERE id = $1", [id]);
    } else {
        await pool.query("DELETE FROM public.user_addresses WHERE id = $1", [id]);
    }
    return { success: true };
};
