const pool = require('../config/db');

// ── Saved refund bank accounts (per user) ──────────────────────────────────
// Customers enter their refund bank details once; they are stored here and
// offered automatically on every later return / cancellation refund.

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const BANK_NAMES = {
    SBIN: 'State Bank of India', HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', UTIB: 'Axis Bank',
    KKBK: 'Kotak Mahindra Bank', PUNB: 'Punjab National Bank', BKID: 'Bank of India',
    UBIN: 'Union Bank of India', BARB: 'Bank of Baroda', CNRB: 'Canara Bank',
    INDB: 'IndusInd Bank', YESB: 'Yes Bank', IDFB: 'IDFC First Bank', FDRL: 'Federal Bank',
    SIBL: 'South Indian Bank', IOBA: 'Indian Overseas Bank', MAHB: 'Bank of Maharashtra',
    CBIN: 'Central Bank of India', UCBA: 'UCO Bank', PSIB: 'Punjab & Sind Bank',
};
const deriveBankName = (ifsc) => BANK_NAMES[(ifsc || '').slice(0, 4).toUpperCase()] || 'Bank';

let tableEnsured = false;
const ensureTable = async () => {
    if (tableEnsured) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.user_bank_accounts (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            holder_name VARCHAR(255) NOT NULL,
            account_number VARCHAR(32) NOT NULL,
            ifsc_code VARCHAR(11) NOT NULL,
            bank_name VARCHAR(100),
            is_default BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE (user_id, account_number, ifsc_code)
        );
        CREATE INDEX IF NOT EXISTS idx_user_bank_accounts_user_id ON public.user_bank_accounts (user_id);
    `);
    tableEnsured = true;
};

const mapRow = (r) => ({
    id: String(r.id),
    holderName: r.holder_name,
    accountNumber: r.account_number,
    ifscCode: r.ifsc_code,
    bankName: r.bank_name || deriveBankName(r.ifsc_code),
    isDefault: r.is_default,
    createdAt: r.created_at,
});

const normalize = (details = {}) => ({
    holderName: String(details.holderName || '').trim(),
    accountNumber: String(details.accountNumber || '').replace(/\D/g, ''),
    ifscCode: String(details.ifscCode || '').trim().toUpperCase(),
});

const validate = ({ holderName, accountNumber, ifscCode }) => {
    if (!holderName) return 'Account holder name is required';
    if (accountNumber.length < 9 || accountNumber.length > 18) return 'Account number must be 9-18 digits';
    if (!IFSC_REGEX.test(ifscCode)) return 'Invalid IFSC code';
    return null;
};

/**
 * One-time backfill: if a user has no saved accounts yet, import the bank details
 * from their most recent refund request so they never have to type them again.
 */
const backfillFromOrders = async (userId) => {
    const res = await pool.query(
        `SELECT refund_holder_name, refund_bank_account, refund_ifsc_code
         FROM orders
         WHERE user_id = $1 AND refund_bank_account IS NOT NULL AND refund_bank_account <> ''
           AND refund_ifsc_code IS NOT NULL AND refund_holder_name IS NOT NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [String(userId)]
    );
    const row = res.rows[0];
    if (!row) return;
    const details = normalize({ holderName: row.refund_holder_name, accountNumber: row.refund_bank_account, ifscCode: row.refund_ifsc_code });
    if (validate(details)) return;
    await exports.saveAccount(userId, details, { makeDefault: true });
};

exports.listAccounts = async (userId) => {
    await ensureTable();
    let res = await pool.query(
        `SELECT * FROM user_bank_accounts WHERE user_id = $1 ORDER BY is_default DESC, updated_at DESC`,
        [String(userId)]
    );
    if (res.rows.length === 0) {
        await backfillFromOrders(userId);
        res = await pool.query(
            `SELECT * FROM user_bank_accounts WHERE user_id = $1 ORDER BY is_default DESC, updated_at DESC`,
            [String(userId)]
        );
    }
    return res.rows.map(mapRow);
};

/**
 * Insert or refresh a saved account (deduplicated on account number + IFSC).
 * The first account a user saves automatically becomes the default.
 */
exports.saveAccount = async (userId, rawDetails, { makeDefault = false } = {}) => {
    await ensureTable();
    const details = normalize(rawDetails);
    const error = validate(details);
    if (error) {
        const err = new Error(error);
        err.statusCode = 400;
        throw err;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const countRes = await client.query('SELECT COUNT(*)::int AS c FROM user_bank_accounts WHERE user_id = $1', [String(userId)]);
        const isFirst = countRes.rows[0].c === 0;
        const setDefault = makeDefault || isFirst;

        if (setDefault) {
            await client.query('UPDATE user_bank_accounts SET is_default = FALSE WHERE user_id = $1', [String(userId)]);
        }

        const res = await client.query(
            `INSERT INTO user_bank_accounts (user_id, holder_name, account_number, ifsc_code, bank_name, is_default)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (user_id, account_number, ifsc_code)
             DO UPDATE SET holder_name = EXCLUDED.holder_name,
                           is_default = user_bank_accounts.is_default OR EXCLUDED.is_default,
                           updated_at = NOW()
             RETURNING *`,
            [String(userId), details.holderName, details.accountNumber, details.ifscCode, deriveBankName(details.ifscCode), setDefault]
        );
        await client.query('COMMIT');
        return mapRow(res.rows[0]);
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

/** Best-effort save used by refund flows — never blocks the request on failure. */
exports.rememberAccount = async (userId, rawDetails) => {
    try {
        if (!userId || !rawDetails) return;
        const details = normalize(rawDetails);
        if (validate(details)) return;
        await exports.saveAccount(userId, details);
    } catch (e) {
        console.error('[BankAccounts] Failed to remember account:', e.message);
    }
};

exports.setDefault = async (userId, accountId) => {
    await ensureTable();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const own = await client.query('SELECT id FROM user_bank_accounts WHERE id = $1 AND user_id = $2', [accountId, String(userId)]);
        if (own.rows.length === 0) {
            const err = new Error('Bank account not found');
            err.statusCode = 404;
            throw err;
        }
        await client.query('UPDATE user_bank_accounts SET is_default = (id = $2), updated_at = NOW() WHERE user_id = $1', [String(userId), accountId]);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
    return exports.listAccounts(userId);
};

exports.deleteAccount = async (userId, accountId) => {
    await ensureTable();
    const res = await pool.query(
        'DELETE FROM user_bank_accounts WHERE id = $1 AND user_id = $2 RETURNING is_default',
        [accountId, String(userId)]
    );
    if (res.rows.length === 0) {
        const err = new Error('Bank account not found');
        err.statusCode = 404;
        throw err;
    }
    // Promote another account if the default was removed
    if (res.rows[0].is_default) {
        await pool.query(
            `UPDATE user_bank_accounts SET is_default = TRUE
             WHERE id = (SELECT id FROM user_bank_accounts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1)`,
            [String(userId)]
        );
    }
    const rest = await pool.query(
        `SELECT * FROM user_bank_accounts WHERE user_id = $1 ORDER BY is_default DESC, updated_at DESC`,
        [String(userId)]
    );
    return rest.rows.map(mapRow);
};
