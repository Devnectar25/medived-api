const pool = require('../config/db');

exports.getAddressesByUserId = async (userId) => {
    const result = await pool.query(
        "SELECT * FROM public.user_addresses WHERE user_id = $1 ORDER BY created_at DESC",
        [userId]
    );
    return result.rows;
};

exports.addAddress = async (data) => {
    const { user_id, address_label, full_address, city, state, postal_code, is_default } = data;

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

    if (is_default) {
        await pool.query(
            "UPDATE public.user_addresses SET is_default = FALSE WHERE user_id = $1",
            [user_id]
        );
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
    await pool.query("DELETE FROM public.user_addresses WHERE id = $1", [id]);
    return { success: true };
};
