// Native bcrypt hashes on libuv's thread pool; bcryptjs runs on the main thread and blocks
// every other request while it works. Both produce and verify the same hashes.
let bcrypt;
try {
    bcrypt = require('bcrypt');
} catch (err) {
    console.warn('[password] Native bcrypt unavailable, falling back to bcryptjs:', err.message);
    bcrypt = require('bcryptjs');
}

const ROUNDS = 10;

exports.hash = (password) => bcrypt.hash(password, ROUNDS);
exports.compare = (password, hash) => bcrypt.compare(password, hash);
