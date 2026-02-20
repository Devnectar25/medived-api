const pool = require('../config/db');
const productService = require('./productService');

/**
 * Chatbot Service — Enhanced NLP Pipeline
 * ─────────────────────────────────────────
 * Pipeline stages (in order):
 *  1.   Sanitize & tokenize the raw query
 *  2.   Detect "alternative product" intent (needs session context)
 *  3.   Detect greetings / farewells
 *  4.   Detect price-filter intents (regex)
 *  4.5  Detect product listing intent ← NEW: "show me products", "list ayurvedic products"
 *  5.   Detect company/people info intent (blocks false product search)
 *  6.   Detect navigation/static intents (regex)
 *  7.   Knowledge-base lookup (DB regex matching)
 *  8.   Direct product search (ILIKE) — only for product-likely queries
 *  9.   Keyword-level product search
 *  10.  Fuzzy product search (word_similarity ≥ 0.35)
 *  11.  Fallback — log to unanswered_queries, always answer politely
 */

// ─── In-Memory Session Context ────────────────────────────────────────────────
// Stores per-session: last products shown, last search keyword, last category
// Expires after 30 minutes of inactivity.

const sessionStore = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getSession(sessionId) {
    const s = sessionStore.get(sessionId);
    if (!s) return { lastProducts: [], lastKeyword: '', lastCategory: '', lastQuery: '' };
    return s;
}

function setSession(sessionId, data) {
    sessionStore.set(sessionId, { ...getSession(sessionId), ...data, _ts: Date.now() });
}

// Cleanup expired sessions every 15 minutes
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessionStore.entries()) {
        if (now - (s._ts || 0) > SESSION_TTL_MS) sessionStore.delete(id);
    }
}, 15 * 60 * 1000);

// ─── NLP Helpers ──────────────────────────────────────────────────────────────

/**
 * Tokenize a query into lowercase words, removing punctuation.
 */
function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

/**
 * Detect the most likely intent using keyword scoring.
 */
function detectIntentFromTokens(tokens) {
    const intentKeywords = {
        greeting: ['hello', 'hi', 'hey', 'hii', 'helo', 'greetings'],
        farewell: ['bye', 'goodbye', 'thanks', 'thank', 'later'],
        alternative: ['another', 'other', 'else', 'different', 'more', 'next', 'alternatives', 'similar', 'suggest'],
        product_search: ['find', 'search', 'show', 'list', 'give', 'suggest', 'recommend', 'need', 'want', 'looking', 'buy', 'purchase'],
        health_query: ['stress', 'anxiety', 'sleep', 'insomnia', 'immunity', 'immune', 'digestion', 'stomach', 'pain', 'joint', 'arthritis'],
        pricing_info: ['price', 'cost', 'expensive', 'cheap', 'affordable', 'budget'],
        website_info: ['order', 'shipping', 'delivery', 'return', 'refund', 'payment', 'checkout', 'track'],
        contact_info: ['contact', 'support', 'email', 'phone', 'call', 'help'],
        about_info: ['about', 'company', 'who', 'mediveda', 'homeveda', 'founder', 'owner', 'ceo', 'team'],
    };

    const scores = {};
    for (const [intent, keywords] of Object.entries(intentKeywords)) {
        scores[intent] = 0;
        for (const token of tokens) {
            if (keywords.includes(token)) scores[intent]++;
        }
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const best = sorted[0];
    if (!best || best[1] === 0) return { intent: 'unknown', confidence: 0 };

    const confidence = Math.min(best[1] / 3, 1.0);
    return { intent: best[0], confidence };
}

/**
 * Extract meaningful keywords from tokens (remove stop words).
 */
function extractKeywords(tokens) {
    const stopWords = new Set([
        'a', 'an', 'the', 'is', 'it', 'in', 'on', 'at', 'to', 'for',
        'of', 'and', 'or', 'but', 'with', 'do', 'i', 'me', 'my', 'we',
        'you', 'he', 'she', 'they', 'this', 'that', 'are', 'was', 'be',
        'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should',
        'what', 'which', 'who', 'how', 'when', 'where', 'please', 'tell',
        'about', 'any', 'some', 'get', 'give', 'show', 'want', 'need',
        'just', 'also', 'else', 'other', 'another',
    ]);
    return tokens.filter(t => t.length > 2 && !stopWords.has(t));
}

/**
 * Heuristic: is this query likely about a product (vs. company/general info)?
 * Returns false for queries that are clearly not product searches.
 */
function isLikelyProductQuery(lowerQuery, tokens) {
    // Patterns that signal a NON-product query — block product search for these
    const nonProductPatterns = [
        /who\s+(is|are|was|owns|founded|runs|leads)/i,
        /\b(owner|founder|ceo|director|president|chairman|manager|head)\b/i,
        /\b(company|organization|organisation|enterprise|business|startup|firm)\b.*\b(info|about|background|history|profile)\b/i,
        /tell\s+me\s+about\s+(homeved|mediveda|the\s+company|your\s+company)/i,
        /what\s+is\s+(homeved|mediveda)/i,
        /\b(when\s+was|when\s+did|how\s+many\s+employees|headquarters|location|address\s+of)\b/i,
    ];

    for (const pattern of nonProductPatterns) {
        if (pattern.test(lowerQuery)) return false;
    }

    return true;
}

/**
 * Check if query expresses an "alternative product" request.
 */
function isAlternativeRequest(lowerQuery) {
    const patterns = [
        /\b(another|other|different|else|alternative|alternatives)\b.*\bproduct/i,
        /\bproduct\b.*\b(another|other|different|else|alternative)\b/i,
        /show\s+me\s+(another|more|other|different|some\s+more)/i,
        /any\s+(other|more|alternative|different)\s+(product|option|item)/i,
        /\b(next|more)\s+(product|option|suggestion|result)/i,
        /don't\s+(like|want)\s+(this|that|it)[,.]?\s*(show|give|suggest|any)/i,
        /something\s+(else|different|other|more)/i,
    ];
    return patterns.some(p => p.test(lowerQuery));
}

/**
 * Detect a product listing intent and extract any category/type keyword.
 *
 * Returns { isListing: true, keyword: string, isGeneral: boolean }
 * or null when the query is NOT a product listing request.
 *
 * Examples:
 *   "show me products"           → { isListing: true, keyword: '',          isGeneral: true  }
 *   "show me ayurvedic products" → { isListing: true, keyword: 'ayurvedic', isGeneral: false }
 *   "list herbal items"          → { isListing: true, keyword: 'herbal',    isGeneral: false }
 *   "what products do you have"  → { isListing: true, keyword: '',          isGeneral: true  }
 */
function detectProductListingIntent(query) {
    const q = query.toLowerCase().trim();

    // ── General listing patterns (no category) ────────────────────────────────
    const generalPatterns = [
        /^show\s*(?:me\s*)?(?:all\s*)?(?:your\s*)?(?:available\s*)?products?$/i,
        /^list\s*(?:all\s*)?(?:your\s*)?(?:available\s*)?products?$/i,
        /^display\s*(?:all\s*)?(?:your\s*)?(?:available\s*)?products?$/i,
        /^view\s*(?:all\s*)?(?:your\s*)?(?:available\s*)?products?$/i,
        /^(?:get|give\s*me)\s*(?:all\s*)?(?:your\s*)?(?:available\s*)?products?$/i,
        /^show\s*(?:me\s*)?(?:all\s*)?(?:available\s*)?items?$/i,
        /^list\s*(?:all\s*)?(?:available\s*)?items?$/i,
        /^display\s*(?:all\s*)?(?:available\s*)?items?$/i,
        /^view\s*(?:all\s*)?(?:available\s*)?items?$/i,
        /^what\s+products?\s+(?:do\s+you\s+have|are\s+available|can\s+i\s+(?:get|buy)|you\s+sell)/i,
        /^(?:show|view)\s+(?:all\s+)?(?:product\s+)?catalog(?:ue)?$/i,
        /^(?:available|all)\s+products?$/i,
        /^product\s+list$/i,
        /^products?$/i,
        /^(?:show|display|view)\s+(?:all\s+)?inventory$/i,
        /^browse\s+(?:all\s+)?products?$/i,
        /^find\s+(?:all\s+)?products?$/i,
        /^do\s+you\s+have\s+(?:any\s+)?products?/i,
        /^what\s+(?:do\s+you\s+sell|are\s+your\s+products?)/i,
    ];

    for (const p of generalPatterns) {
        if (p.test(q)) return { isListing: true, keyword: '', isGeneral: true };
    }

    // ── Category-specific listing patterns ────────────────────────────────────
    // e.g. "show me ayurvedic products", "list herbal items", "find immunity products"
    const categoryPatterns = [
        // show/list/display/find/get [me] [all] [your] [available] <KEYWORD> products/items
        /(?:show|list|display|find|get|search|browse)\s+(?:me\s+)?(?:all\s+)?(?:your\s+)?(?:available\s+)?([\w]+(?:\s+[\w]+)?)\s+products?/i,
        /(?:show|list|display|find|get|search|browse)\s+(?:me\s+)?(?:all\s+)?(?:your\s+)?(?:available\s+)?([\w]+(?:\s+[\w]+)?)\s+items?/i,
        // products for/related to/about <KEYWORD>
        /products?\s+(?:for|related\s+to|about|in)\s+([\w]+(?:\s+[\w]+)?)/i,
        // do you have <KEYWORD> products
        /(?:do\s+you\s+have|got\s+any|have\s+any)\s+([\w]+(?:\s+[\w]+)?)\s+products?/i,
    ];

    // Words that are NOT real category keywords — if the extracted keyword is
    // one of these, fall back to a general listing.
    const skipKeywords = new Set([
        'all', 'your', 'available', 'some', 'the', 'any', 'me',
        'product', 'products', 'item', 'items', 'show', 'list',
        'good', 'best', 'top', 'nice', 'great', 'new', 'more',
        'cheap', 'affordable', 'popular', 'latest', 'featured',
    ]);

    for (const p of categoryPatterns) {
        const match = q.match(p);
        if (match && match[1]) {
            const keyword = match[1].trim().toLowerCase();
            // Multi-word: only accept if all words are meaningful
            const words = keyword.split(/\s+/);
            const allMeaningful = words.every(w => w.length > 2 && !skipKeywords.has(w));

            if (allMeaningful && keyword.length > 2) {
                return { isListing: true, keyword, isGeneral: false };
            }
            // Keyword was too generic (like "show me all products") → treat as general listing
            return { isListing: true, keyword: '', isGeneral: true };
        }
    }

    // ── Direct single word listing (e.g. "ayurvedic", "herbal") ────────────────
    const singleWords = q.split(/\s+/);
    if (singleWords.length === 1 && !skipKeywords.has(singleWords[0]) && singleWords[0].length > 3) {
        // Check if it's a known intent like 'greeting' etc.
        const { intent } = detectIntentFromTokens([singleWords[0]]);
        if (intent === 'unknown' || intent === 'product_search') {
            return { isListing: true, keyword: singleWords[0], isGeneral: false };
        }
    }

    return null; // not a product listing query
}

// ─── Unanswered Query Logger ───────────────────────────────────────────────────

async function logUnansweredQuery(query, suggestedIntent = 'unknown') {
    try {
        const sql = `
            INSERT INTO chatbot_unanswered_queries (query, suggested_intent, occurrence_count)
            VALUES ($1, $2, 1)
            ON CONFLICT (query)
            DO UPDATE SET
                occurrence_count = chatbot_unanswered_queries.occurrence_count + 1,
                updated_at = CURRENT_TIMESTAMP
        `;
        await pool.query(sql, [query.toLowerCase().trim(), suggestedIntent]);
        console.log(`📝 Logged unanswered query: "${query}"`);
    } catch (err) {
        console.error('Unanswered query log error:', err.message);
    }
}

// ─── Product Click Logger ─────────────────────────────────────────────────────

async function logProductClick(productId, productName, sessionId = 'default') {
    try {
        // Create table if not exists (for this specific story)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chatbot_product_clicks (
                id SERIAL PRIMARY KEY,
                product_id VARCHAR(50) NOT NULL,
                product_name TEXT,
                session_id VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const sql = `
            INSERT INTO chatbot_product_clicks (product_id, product_name, session_id)
            VALUES ($1, $2, $3)
        `;
        await pool.query(sql, [productId, productName, sessionId]);
        console.log(`📊 Logged click for product: ${productName} (${productId})`);
    } catch (err) {
        console.error('Product click log error:', err.message);
    }
}

// ─── Alternative Products Helper ──────────────────────────────────────────────

/**
 * Fetch alternative products excluding the IDs already shown this session.
 * Tries same keyword first, then same category, then random popular products.
 */
async function getAlternativeProducts(session) {
    const excludeIds = (session.lastProducts || []).map(p => p.id).filter(Boolean);
    const keyword = session.lastKeyword || '';
    const category = session.lastCategory || '';

    // Build exclusion clause
    const excludeSql = excludeIds.length > 0
        ? `AND p.product_id NOT IN (${excludeIds.map((_, i) => `$${i + 2}`).join(',')})`
        : '';

    // 1. Same keyword, different products
    if (keyword) {
        try {
            const sql = `
                SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
                FROM products p
                LEFT JOIN category c ON p.category_id = c.category_id
                LEFT JOIN brand b ON p.brand = b.brand_id
                LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
                WHERE p.active = true
                  AND (p.productname ILIKE $1 OR p.description ILIKE $1 OR c.name ILIKE $1)
                  ${excludeSql}
                ORDER BY RANDOM()
                LIMIT 5
            `;
            const params = [`%${keyword}%`, ...excludeIds];
            const result = await pool.query(sql, params);
            if (result.rows.length > 0) {
                return result.rows.map(r => ({
                    id: r.product_id?.toString() || '',
                    name: r.productname || '',
                    price: parseFloat(r.price) || 0,
                    image: r.image || 'https://via.placeholder.com/300',
                    rating: parseFloat(r.rating) || 0,
                    inStock: r.instock,
                    description: r.shortdescription || r.description || '',
                }));
            }
        } catch (e) { /* fall through */ }
    }

    // 2. Same category, different products
    if (category) {
        try {
            const sql = `
                SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
                FROM products p
                LEFT JOIN category c ON p.category_id = c.category_id
                LEFT JOIN brand b ON p.brand = b.brand_id
                LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
                WHERE p.active = true
                  AND (c.name ILIKE $1 OR p.category_id::text = $1)
                  ${excludeSql}
                ORDER BY RANDOM()
                LIMIT 5
            `;
            const params = [`%${category}%`, ...excludeIds];
            const result = await pool.query(sql, params);
            if (result.rows.length > 0) {
                return result.rows.map(r => ({
                    id: r.product_id?.toString() || '',
                    name: r.productname || '',
                    price: parseFloat(r.price) || 0,
                    image: r.image || 'https://via.placeholder.com/300',
                    rating: parseFloat(r.rating) || 0,
                    inStock: r.instock,
                    description: r.shortdescription || r.description || '',
                }));
            }
        } catch (e) { /* fall through */ }
    }

    // 3. Popular/promoted products as last resort
    try {
        const sql = `
            SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
            FROM products p
            LEFT JOIN category c ON p.category_id = c.category_id
            LEFT JOIN brand b ON p.brand = b.brand_id
            LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
            WHERE p.active = true ${excludeSql.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) - 1}`)}
            ORDER BY p.promoted DESC, p.rating DESC
            LIMIT 5
        `;
        // Rebuild for no-keyword case
        const result = await pool.query(
            `SELECT p.*, c.name as category_name, b.name as brand_name, sc.name as subcategory_name
            FROM products p
            LEFT JOIN category c ON p.category_id = c.category_id
            LEFT JOIN brand b ON p.brand = b.brand_id
            LEFT JOIN subcategory sc ON p.subcategory_id = sc.srno
            WHERE p.active = true
            ORDER BY p.promoted DESC, p.rating DESC NULLS LAST
            LIMIT 8`
        );
        const rows = result.rows.filter(r => !excludeIds.includes(r.product_id?.toString())).slice(0, 5);
        return rows.map(r => ({
            id: r.product_id?.toString() || '',
            name: r.productname || '',
            price: parseFloat(r.price) || 0,
            image: r.image || 'https://via.placeholder.com/300',
            rating: parseFloat(r.rating) || 0,
            inStock: r.instock,
            description: r.shortdescription || r.description || '',
        }));
    } catch (e) {
        return [];
    }
}

// ─── Main NLP Query Processor ─────────────────────────────────────────────────

/**
 * Process a user query through the full NLP pipeline.
 * Always returns a response — never leaves the user unanswered.
 *
 * @param {string} query
 * @param {string} sessionId  — used to track conversation context
 */
exports.processQuery = async (query, sessionId = 'default') => {
    if (!query) {
        return {
            answer: "Sorry, we don't have too much knowledge about that.",
            intent: 'fallback',
            confidence: 0.0,
            products: []
        };
    }

    const sanitizedQuery = query.trim();
    const lowerQuery = sanitizedQuery.toLowerCase();

    // ── Stage 1: Tokenize & Extract Keywords ─────────────────────────────────
    const tokens = tokenize(sanitizedQuery);
    const keywords = extractKeywords(tokens);
    const { intent: detectedIntent } = detectIntentFromTokens(tokens);

    console.log(`🧠 NLP | "${sanitizedQuery}" | tokens: [${tokens.slice(0, 8).join(', ')}] | intent: ${detectedIntent}`);

    // ── Stage 2: Alternative Product Request ─────────────────────────────────
    if (isAlternativeRequest(lowerQuery)) {
        const session = getSession(sessionId);
        const alternatives = await getAlternativeProducts(session);

        if (alternatives.length > 0) {
            // Update session: add newly shown product IDs to exclusion list
            const allShown = [
                ...(session.lastProducts || []),
                ...alternatives,
            ].slice(-20); // keep last 20 shown
            setSession(sessionId, { lastProducts: allShown });

            return {
                answer: session.lastKeyword
                    ? `Here are some alternative "${session.lastKeyword}" products for you:`
                    : `Here are some other products you might like:`,
                intent: 'alternative_request',
                confidence: 1.0,
                products: alternatives
            };
        }

        return {
            answer: "Sorry, I don't have any more product suggestions right now.\nTry asking about a different product or category!",
            intent: 'alternative_request',
            confidence: 0.9,
            products: []
        };
    }

    // ── Stage 3: Greeting Detection ───────────────────────────────────────────
    const exactGreetings = ['hi', 'hello', 'hii', 'helo', 'hey', 'greetings'];
    if (exactGreetings.includes(lowerQuery)) {
        return {
            answer: "Hello! I'm HomeVed HealthBot, your Ayurvedic wellness assistant. 🌿\nHow can I help you today? You can ask me about:\n• Products (e.g. \"Ashwagandha\", \"Triphala\")\n• Health topics (e.g. \"stress relief\", \"immunity\")\n• Pricing, shipping, returns, or company info",
            intent: 'greeting',
            confidence: 1.0,
            products: []
        };
    }

    // ── Stage 4: Price Filtering Detection ────────────────────────────────────
    const priceBetweenRegex = /(?:between|from)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(?:to|-|and)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)/i;
    const priceUnderRegex = /(?:under|below|less than|affordable|budget|within)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)/i;
    const priceAboveRegex = /(?:above|greater than|more than|higher than|from)\s*(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)/i;

    const betweenMatch = sanitizedQuery.match(priceBetweenRegex);
    const underMatch = sanitizedQuery.match(priceUnderRegex);
    const aboveMatch = sanitizedQuery.match(priceAboveRegex);

    if (betweenMatch) {
        const minPrice = parseFloat(betweenMatch[1]);
        const maxPrice = parseFloat(betweenMatch[2]);
        const priceProducts = await productService.chatbotSearchByPrice(maxPrice);
        const filtered = priceProducts.filter(p => p.price >= minPrice);
        if (filtered.length > 0) {
            let answer = `Here are products between ₹${minPrice} and ₹${maxPrice}:\n`;
            filtered.slice(0, 5).forEach(p => { answer += `• ${p.name}: ₹${p.price}\n`; });
            if (filtered.length > 5) answer += `...and ${filtered.length - 5} more.`;
            setSession(sessionId, { lastProducts: filtered, lastKeyword: '', lastCategory: '' });
            return { answer: answer.trim(), intent: 'price_filter', confidence: 1.0, products: filtered };
        }
        return { answer: `Sorry, no products available between ₹${minPrice} and ₹${maxPrice}.`, intent: 'price_filter', confidence: 1.0, products: [] };
    }

    if (underMatch) {
        const maxPrice = parseFloat(underMatch[1]);
        const priceProducts = await productService.chatbotSearchByPrice(maxPrice);
        if (priceProducts.length > 0) {
            let answer = `Here are products under ₹${maxPrice}:\n`;
            priceProducts.slice(0, 5).forEach(p => { answer += `• ${p.name}: ₹${p.price}\n`; });
            if (priceProducts.length > 5) answer += `...and ${priceProducts.length - 5} more.`;
            setSession(sessionId, { lastProducts: priceProducts, lastKeyword: '', lastCategory: '' });
            return { answer: answer.trim(), intent: 'price_filter', confidence: 1.0, products: priceProducts };
        }
        return { answer: `Sorry, no products available under ₹${maxPrice}.`, intent: 'price_filter', confidence: 1.0, products: [] };
    }

    if (aboveMatch) {
        const minPrice = parseFloat(aboveMatch[1]);
        const priceProducts = await productService.chatbotSearchByPriceAbove(minPrice);
        if (priceProducts.length > 0) {
            let answer = `Here are products above ₹${minPrice}:\n`;
            priceProducts.slice(0, 5).forEach(p => { answer += `• ${p.name}: ₹${p.price}\n`; });
            if (priceProducts.length > 5) answer += `...and ${priceProducts.length - 5} more.`;
            setSession(sessionId, { lastProducts: priceProducts, lastKeyword: '', lastCategory: '' });
            return { answer: answer.trim(), intent: 'price_filter_above', confidence: 1.0, products: priceProducts };
        }
        return { answer: `Sorry, no products available above ₹${minPrice}.`, intent: 'price_filter_above', confidence: 1.0, products: [] };
    }

    // ── Stage 4.5: Product Listing Intent ────────────────────────────────────
    // Must run BEFORE company-info guard and product search stages.
    const listingIntent = detectProductListingIntent(lowerQuery);
    if (listingIntent) {
        let listProducts = [];
        let listAnswer;

        if (listingIntent.isGeneral) {
            // "show me products" / "list all products" → return popular/featured products
            listProducts = await productService.chatbotGetProducts(10);
            listAnswer = listProducts.length > 0
                ? `Here are our available products (${listProducts.length} shown). Click any to view details:`
                : null;
        } else {
            // "show me ayurvedic products" → category/keyword filtered listing
            listProducts = await productService.chatbotSearchByCategory(listingIntent.keyword, 10);
            if (listProducts.length === 0) {
                // Broaden: try simple ILIKE search as fallback
                listProducts = await productService.simpleChatbotSearch(listingIntent.keyword);
            }
            listAnswer = listProducts.length > 0
                ? `Here are ${listProducts.length} "${listingIntent.keyword}" product${listProducts.length > 1 ? 's' : ''} I found. Click any to view details:`
                : null;
        }

        if (listProducts.length > 0) {
            setSession(sessionId, {
                lastProducts: listProducts,
                lastKeyword: listingIntent.keyword,
                lastCategory: listProducts[0]?.category || '',
            });
            return {
                answer: listAnswer,
                intent: 'product_listing',
                confidence: 1.0,
                products: listProducts,
            };
        }

        // No products found at all
        await logUnansweredQuery(sanitizedQuery, 'product_listing');
        return {
            answer: listingIntent.isGeneral
                ? "Sorry, we don't have products available right now."
                : `Sorry, we don't have any "${listingIntent.keyword}" products available right now.\nTry asking about a different category or type!`,
            intent: 'product_listing',
            confidence: 1.0,
            products: [],
        };
    }

    // ── Stage 5: Company / People Info Guard ──────────────────────────────────
    // Must run BEFORE product search to prevent wrong fuzzy matches.
    const companyInfoPatterns = [
        {
            pattern: /who\s+(is|are|was)\s+(the\s+)?(owner|founder|ceo|director|head|president|co-founder)/i,
            answer: "HomeVed is a wellness company built by a passionate team dedicated to bringing authentic Ayurvedic products to every home.\n\nFor specific leadership or ownership information, please visit our official website or contact us at support@mediveda.com.\n📞 +91 1800-123-4567"
        },
        {
            pattern: /\b(owner|founder|ceo|chairman|president|co-founder|director)\b.*\b(homeved|mediveda|company|of)\b/i,
            answer: "HomeVed is founded and managed by a team passionate about Ayurvedic wellness.\n\nFor leadership details, please visit our About page or contact us at support@mediveda.com."
        },
        {
            pattern: /\b(homeved|mediveda)\b.*\b(owner|founder|ceo|founded|established|started|created)/i,
            answer: "HomeVed is an Ayurvedic health & wellness platform committed to authentic, natural products.\n\nFor specific company or leadership information, please contact us at support@mediveda.com or +91 1800-123-4567."
        },
        {
            pattern: /about\s+(homeved|mediveda|us|the\s+company|our\s+company)/i,
            answer: "About HomeVed:\n\nMission: To bring the authentic wisdom of Ayurveda to every home for holistic well-being.\nVision: To become the most trusted platform for natural, safe, and effective Ayurvedic healthcare products.\nServices: We offer a curated range of high-quality Ayurvedic supplements, skincare, and wellness products, along with expert guidance on traditional health practices.\n\nContact us: support@mediveda.com | +91 1800-123-4567"
        },
        {
            pattern: /what\s+(is|are)\s+(homeved|mediveda)/i,
            answer: "HomeVed (Mediveda) is a trusted Ayurvedic wellness platform offering:\n• 100% natural and authentic products\n• Traditional Ayurvedic formulations\n• Quality-tested supplements\n• Expert wellness guidance\n\nVisit our About page to learn more!"
        },
    ];

    for (const item of companyInfoPatterns) {
        if (item.pattern.test(sanitizedQuery)) {
            return {
                answer: item.answer,
                intent: 'about_info',
                confidence: 1.0,
                products: []
            };
        }
    }

    // ── Stage 6: Navigation & Static Intents (Regex) ─────────────────────────
    const navigationQueries = [
        {
            pattern: /privacy\s*policy/i,
            answer: "Privacy Policy:\n\nHomeVed is committed to protecting your privacy. We collect and use your personal information (such as name, email, and address) solely to process your orders and improve your shopping experience. We do not sell or share your data with third parties for marketing purposes. All transactions are secured with industry-standard encryption.",
            intent: 'navigation'
        },
        {
            pattern: /return\s*policy|refund\s*policy/i,
            answer: "Return Policy:\n\nWe want you to be completely satisfied with your purchase. If you're not happy with a product, you can return it within 7 days of delivery. The item must be unused, in its original packaging, and with all tags intact. A full refund will be processed back to your original payment method within 5-7 business days.",
            intent: 'navigation'
        },
        {
            pattern: /login|sign\s*in|how\s*to\s*login/i,
            answer: "To login to HomeVed:\n1. Go to the HomeVed website.\n2. Click on the 'Account' icon or 'Login' button at the top right.\n3. Enter your registered email and password.\n4. Click 'Submit' or 'Login' to access your account.\n5. If you forgot your password, use the 'Forgot Password' option.",
            intent: 'navigation'
        },
        {
            pattern: /how\s*(to\s*)?order|place\s*(an?\s*)?order|ordering|how\s*to\s*buy/i,
            answer: "Ordering is easy! 🛒\n1. Browse our products\n2. Click 'Add to Cart' on items you like\n3. Go to Cart and click 'Checkout'\n4. Enter your shipping details\n5. Complete payment securely\n\nNeed help with a specific step?",
            intent: 'navigation'
        },
        {
            pattern: /shipping|delivery|how\s*long/i,
            answer: "Shipping Information:\n• FREE delivery on all orders\n• Delivery within 5-7 business days\n• Track your order anytime from 'My Orders'\n• Authentic products guaranteed",
            intent: 'navigation'
        },
        {
            pattern: /contact|support|email|phone|call\s*us/i,
            answer: "Contact Us:\n📧 Email: support@mediveda.com\n📞 Phone: +91 1800-123-4567\n⏰ Hours: Mon-Sat, 9 AM – 6 PM\n\nWe typically respond within 24 hours!",
            intent: 'contact_info'
        },
        {
            pattern: /payment|pay|payment\s*method/i,
            answer: "Payment Methods Accepted:\n• Credit / Debit Cards\n• UPI (Google Pay, PhonePe, etc.)\n• Net Banking\n• Digital Wallets\n\nAll payments are 100% secure and encrypted. 🔒",
            intent: 'navigation'
        },
        {
            pattern: /return|refund|exchange/i,
            answer: "Return & Refund Policy:\n• 7-day return window from delivery\n• Items must be unused and in original packaging\n• Contact support@mediveda.com to initiate a return\n• Full refund processed within 5-7 business days",
            intent: 'navigation'
        },
    ];

    for (const nav of navigationQueries) {
        if (nav.pattern.test(sanitizedQuery)) {
            return {
                answer: nav.answer,
                intent: nav.intent,
                confidence: 1.0,
                products: []
            };
        }
    }

    // ── Stage 7: Knowledge-Base Lookup (DB regex, word-boundary aware) ────────
    const knowledgeSql = `
        SELECT * FROM chatbot_knowledge 
        WHERE is_approved = true AND $1 ~* ('\\y(' || query_pattern || ')\\y')
        ORDER BY confidence_score DESC
        LIMIT 1
    `;
    try {
        const knowledgeResult = await pool.query(knowledgeSql, [sanitizedQuery]);

        if (knowledgeResult.rows.length > 0) {
            const entry = knowledgeResult.rows[0];

            // Increment usage count asynchronously
            pool.query(
                'UPDATE chatbot_knowledge SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = $1',
                [entry.id]
            ).catch(() => { });

            let products = [];
            if (entry.intent === 'product_info' || entry.intent === 'product_search') {
                const keyword = entry.keywords && entry.keywords.length > 0
                    ? entry.keywords[0]
                    : sanitizedQuery;
                products = await productService.simpleChatbotSearch(keyword);
                if (products.length > 0) {
                    setSession(sessionId, {
                        lastProducts: products,
                        lastKeyword: keyword,
                        lastCategory: products[0]?.category || ''
                    });
                }
            }

            return {
                answer: entry.answer,
                intent: entry.intent,
                confidence: parseFloat(entry.confidence_score),
                products
            };
        }
    } catch (err) {
        console.error('Knowledge-base lookup error:', err.message);
    }

    // ── Stages 8–10: Product Search (only if likely a product query) ──────────
    const productSearchAllowed = isLikelyProductQuery(lowerQuery, tokens);

    if (productSearchAllowed) {
        // Stage 8: Direct product search (ILIKE on full query)
        const directProducts = await productService.simpleChatbotSearch(sanitizedQuery);
        if (directProducts.length > 0) {
            setSession(sessionId, {
                lastProducts: directProducts,
                lastKeyword: sanitizedQuery,
                lastCategory: directProducts[0]?.category || ''
            });
            return {
                answer: `I found ${directProducts.length} product${directProducts.length > 1 ? 's' : ''} matching "${sanitizedQuery}":`,
                intent: 'product_search',
                confidence: 1.0,
                products: directProducts
            };
        }

        // Stage 9: Keyword-level product search
        if (keywords.length > 0) {
            for (const kw of keywords) {
                const kwProducts = await productService.simpleChatbotSearch(kw);
                if (kwProducts.length > 0) {
                    setSession(sessionId, {
                        lastProducts: kwProducts,
                        lastKeyword: kw,
                        lastCategory: kwProducts[0]?.category || ''
                    });
                    return {
                        answer: `Here are products related to "${kw}":`,
                        intent: 'product_search',
                        confidence: 0.85,
                        products: kwProducts
                    };
                }
            }
        }

        // Stage 10: Fuzzy product search — RAISED threshold to 0.35 to reduce false positives
        const fuzzySql = `
            SELECT product_id, productname, word_similarity($1, productname) AS score
            FROM products
            WHERE active = true AND word_similarity($1, productname) > 0.35
            ORDER BY score DESC
            LIMIT 1
        `;
        try {
            const fuzzyResult = await pool.query(fuzzySql, [sanitizedQuery]);

            if (fuzzyResult.rows.length > 0 && fuzzyResult.rows[0].score > 0.35) {
                const suggestedName = fuzzyResult.rows[0].productname;
                const matchedProducts = await productService.simpleChatbotSearch(suggestedName);

                if (matchedProducts.length > 0) {
                    setSession(sessionId, {
                        lastProducts: matchedProducts,
                        lastKeyword: suggestedName,
                        lastCategory: matchedProducts[0]?.category || ''
                    });
                    return {
                        answer: `Did you mean "${suggestedName}"? Here's what I found:`,
                        intent: 'product_search_fuzzy',
                        confidence: parseFloat(fuzzyResult.rows[0].score),
                        products: matchedProducts,
                        suggestion: suggestedName
                    };
                }
            }
        } catch (err) {
            console.error('Fuzzy search error:', err.message);
        }
    }

    // ── Stage 11: Fallback — always answer, never leave unanswered ────────────
    await logUnansweredQuery(sanitizedQuery, detectedIntent);

    return {
        answer: "Sorry, we don't have too much knowledge about that.\n\nYou can try asking about:\n• Product names (e.g. \"Ashwagandha\", \"Turmeric\", \"Triphala\")\n• Health topics (e.g. \"stress relief\", \"immunity\", \"digestion\")\n• Company info (e.g. \"about HomeVed\", \"contact\", \"return policy\")\n• Pricing (e.g. \"products under ₹500\")",
        intent: 'fallback',
        confidence: 0.0,
        products: []
    };
};

// ─── Query Logger ──────────────────────────────────────────────────────────────

exports.logQuery = async (data) => {
    const { userQuery, matchedPattern, intent, response, confidence, wasSuccessful, sessionId } = data;
    try {
        const sql = `
            INSERT INTO chatbot_query_logs 
            (user_query, matched_pattern, intent, response, confidence_score, was_successful, session_id, needs_review)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        const needsReview = !wasSuccessful || confidence < 0.5;
        await pool.query(sql, [
            userQuery, matchedPattern, intent, response,
            confidence, wasSuccessful, sessionId, needsReview
        ]);
    } catch (err) {
        console.error('Query logging error:', err.message);
    }
};

// ─── Exports for testing ───────────────────────────────────────────────────────
exports.logProductClick = logProductClick;
exports._nlpHelpers = {
    tokenize,
    extractKeywords,
    detectIntentFromTokens,
    isLikelyProductQuery,
    isAlternativeRequest,
};
