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
        // Support English, Hindi (\u0900-\u097F), and Punjabi (\u0A00-\u0A7F)
        .replace(/[^a-z0-9\s\u0900-\u097F\u0A00-\u0A7F]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

/**
 * Detect the most likely intent using keyword scoring.
 */
function detectIntentFromTokens(tokens) {
    const intentKeywords = {
        greeting: ['hello', 'hi', 'hey', 'hii', 'helo', 'greetings', 'नमस्ते', 'नमस्कार', 'हेल्लो', 'हाय', 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ', 'ਹੈਲੋ', 'ਸਤਿ', 'ਸ੍ਰੀ'],
        farewell: ['bye', 'goodbye', 'thanks', 'thank', 'later', 'अलविदा', 'धन्यवाद', 'शुक्रिया', 'नमस्ते', 'ਅਲਵਿਦਾ', 'ਧੰਨਵਾਦ', 'ਸ਼ੁਕਰੀਆ'],
        alternative: ['another', 'other', 'else', 'different', 'more', 'next', 'alternatives', 'similar', 'suggest', 'दूसरा', 'अन्य', 'और', 'अलग', 'विकल्प', 'ਹੋਰ', 'ਦੂਜਾ', 'ਵਿਕਲਪ'],
        product_search: ['find', 'search', 'show', 'list', 'give', 'suggest', 'recommend', 'need', 'want', 'looking', 'buy', 'purchase', 'खोजें', 'दिखाएं', 'सूची', 'दें', 'चाहिए', 'खरीदना', 'ਖੋਜੋ', 'ਦਿਖਾਓ', 'ਸੂਚੀ', 'ਚਾਹੀਦਾ', 'ਖਰੀਦੋ'],
        health_query: ['stress', 'anxiety', 'sleep', 'insomnia', 'immunity', 'immune', 'digestion', 'stomach', 'pain', 'joint', 'arthritis', 'तनाव', 'चिंता', 'नींद', 'प्रतिरक्षा', 'पाचन', 'पेट', 'दर्द', 'गठिया', 'ਤਣਾਅ', 'ਚਿੰਤਾ', 'ਨੀਂਦ', 'ਪਾਚਨ', 'ਦਰਦ'],
        pricing_info: ['price', 'cost', 'expensive', 'cheap', 'affordable', 'budget', 'कीमत', 'मूल्य', 'कितना', 'सस्ता', 'महंगा', 'बजट', 'ਕੀਮਤ', 'ਮੁੱਲ', 'ਕਿੰਨਾ', 'ਸਸਤਾ', 'ਮਹਿੰਗਾ'],
        website_info: ['order', 'shipping', 'delivery', 'return', 'refund', 'payment', 'checkout', 'track', 'ऑर्डर', 'शिपिंग', 'डिलिवरी', 'वापसी', 'भुगतान', 'ट्रैक', 'ਆਰਡਰ', 'ਸ਼ਿਪਿੰਗ', 'ਵਾਪਸੀ', 'ਭੁਗਤਾਨ'],
        contact_info: ['contact', 'support', 'email', 'phone', 'call', 'help', 'संपर्क', 'सहायता', 'ईमेल', 'फोन', 'कॉल', 'मदद', 'ਸੰਪਰਕ', 'ਸਹਾਇਤਾ', 'ਮਦਦ'],
        about_info: ['about', 'company', 'who', 'mediveda', 'homeveda', 'founder', 'owner', 'ceo', 'team', 'बारे', 'कंपनी', 'कौन', 'मालिक', 'संस्थापक', 'ਬਾਰੇ', 'ਕੌਣ', 'ਮਾਲਕ'],
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
        'का', 'की', 'के', 'में', 'पर', 'से', 'को', 'है', 'हैं', 'था', 'थी', 'थे',
        'और', 'या', 'भी', 'कि', 'तो', 'ही', 'लिए', 'बारे', 'क्या', 'कौन', 'कैसे',
        'ਕਾ', 'ਕੀ', 'ਕੇ', 'ਵਿੱਚ', 'ਪਰ', 'ਸੇ', 'ਨੂੰ', 'ਹੈ', 'ਹਨ', 'ਸੀ', 'ਅਤੇ', 'ਜਾਂ', 'ਵੀ', 'ਲਈ',
        'ਕਹਾਂ', 'ਕਬ', 'ਕਿਉਂ', 'ਕਿਰਪਾ', 'ਦੱਸੋ', 'ਦਿਖਾਓ', 'ਚਾਹੀਦਾ', 'ਦੇ'
    ]);
    return tokens.filter(t => t.length > 1 && !stopWords.has(t));
}
/**
 * Maps Hindi/Punjabi keywords to English for database searching.
 */
function normalizeKeyword(keyword) {
    const mapping = {
        'अश्वगंधा': 'ashwagandha', 'ਅਸ਼ਵਗੰਧਾ': 'ashwagandha',
        'त्रिफला': 'triphala', 'ਤ੍ਰਿਫਲਾ': 'triphala',
        'ब्राह्मी': 'brahmi', 'ਬ੍ਰਾਹਮੀ': 'brahmi',
        'शतावरी': 'shatavari', 'ਸ਼ਤਾਵਰੀ': 'shatavari',
        'गिलोय': 'giloy', 'ਗਿਲੋਏ': 'giloy',
        'आंवला': 'amla', 'ਆਮਲਾ': 'amla',
        'शिलाजीत': 'shilajit', 'ਸ਼ਿਲਾਜੀਤ': 'shilajit',
        'हल्दी': 'turmeric', 'ਹਲਦੀ': 'turmeric',
        'तुलसी': 'tulsi', 'ਤੁਲਸੀ': 'tulsi',
        'चूर्ण': 'churna', 'ਚੂਰਨ': 'churna',
        'तेल': 'oil', 'ਤੇਲ': 'oil',
        'कैप्सूल': 'capsule', 'ਕੈਪਸੂਲ': 'capsule',
        'गोली': 'tablet', 'ਗੋਲੀ': 'tablet',
        'नींद': 'sleep', 'ਨੀਂਦ': 'sleep',
        'दर्द': 'pain', 'ਦਰਦ': 'pain',
        'पाचन': 'digestion', 'ਪਾਚਨ': 'digestion',
        'पेट': 'stomach', 'ਪੇਟ': 'stomach',
        'तनाव': 'stress', 'ਤਣਾਅ': 'stress',
        'चिंता': 'anxiety', 'ਚਿੰਤਾ': 'anxiety',
        'त्वचा': 'skin', 'ਤਵਚਾ': 'skin',
        'बाल': 'hair', 'ਵਾਲ': 'hair',
        'ऊर्जा': 'energy', 'ਊਰਜਾ': 'energy',
        'वजन': 'weight', 'ਵਜ਼ਨ': 'weight',
        'गठिया': 'arthritis', 'ਗਠੀਆ': 'arthritis',
        'आयुर्वेदिक': 'ayurvedic', 'ਆਯੁਰਵੈਦਿਕ': 'ayurvedic',
        'जड़ी-बूटी': 'herbal', 'ਜੜੀ-ਬੂਟੀ': 'herbal',
        'दवा': 'medicine', 'ਦਵਾਈ': 'medicine',
        'उत्पाद': 'product', 'ਉਤਪਾਦ': 'product',
        'डाबर': 'dabur', 'ਡਾਬਰ': 'dabur',
        'च्यवनप्राश': 'chyawanprakash', 'ਚਯਵਨਪ੍ਰਾਸ਼': 'chyawanprakash',
        'झंडू': 'zandu', 'ਜ਼ੰਡੂ': 'zandu',
        'हिमालय': 'himalaya', 'ਹਿਮਾਲਿਆ': 'himalaya',
        'पतंजलि': 'patanjali', 'ਪਤੰਜਲੀ': 'patanjali',
        'बैद्यनाथ': 'baidyanath', 'ਬੈਦਿਆਨਾਥ': 'baidyanath',
        'चरक': 'charak', 'ਚਰਕ': 'charak',
        'हर्बल': 'herbal', 'ਹਰਬਲ': 'herbal',
        'सिरप': 'syrup', 'ਸੀਰਪ': 'syrup',
        'गैस': 'gas', 'ਗੈਸ': 'gas',
        'एसिडिटी': 'acidity', 'ਐਸੀਡਿਟੀ': 'acidity'
    };
    return mapping[keyword] || keyword;
}

/**
 * Basic transliteration/translation for English text to Hindi/Punjabi script.
 * Focuses on Ayurvedic product names and common health terms.
 */
function localizeText(text, language) {
    if (!text || language === 'en') return text;

    const dictionary = {
        'ashwagandha': { hi: 'अश्वगंधा', pa: 'ਅਸ਼ਵਗੰਧਾ' },
        'triphala': { hi: 'त्रिफला', pa: 'ਤ੍ਰਿਫਲਾ' },
        'brahmi': { hi: 'ब्राह्मी', pa: 'ਬ੍ਰਾਹਮੀ' },
        'shatavari': { hi: 'शतावरी', pa: 'ਸ਼ਤਾਵਰੀ' },
        'giloy': { hi: 'गिलोय', pa: 'ਗਿਲੋਏ' },
        'amla': { hi: 'आंवला', pa: 'ਆਮਲਾ' },
        'shilajit': { hi: 'शिलाजीत', pa: 'ਸ਼ਿਲਾਜੀਤ' },
        'turmeric': { hi: 'हल्दी', pa: 'ਹਲਦੀ' },
        'tulsi': { hi: 'तुलसी', pa: 'ਤੁਲਸੀ' },
        'churna': { hi: 'चूर्ण', pa: 'ਚੂਰਨ' },
        'oil': { hi: 'तेल', pa: 'ਤੇਲ' },
        'capsule': { hi: 'कैप्सूल', pa: 'ਕੈਪਸੂਲ' },
        'capsules': { hi: 'कैप्सूल', pa: 'ਕੈਪਸੂਲ' },
        'tablet': { hi: 'गोली', pa: 'ਗੋਲੀ' },
        'tablets': { hi: 'गोलियां', pa: 'ਗੋਲੀਆਂ' },
        'syrup': { hi: 'सिरप', pa: 'ਸੀਰਪ' },
        'powder': { hi: 'पाउडर', pa: 'ਪਾਊਡਰ' },
        'neem': { hi: 'नीम', pa: 'ਨੀਮ' },
        'honey': { hi: 'शहद', pa: 'ਸ਼ਹਿਦ' },
        'ayurvedic': { hi: 'आयुर्वेदिक', pa: 'ਆਯੁਰਵੈਦਿਕ' },
        'product': { hi: 'उत्पाद', pa: 'ਉਤਪਾਦ' },
        'products': { hi: 'उत्पाद', pa: 'ਉਤਪਾਦ' },
        'price': { hi: 'कीमत', pa: 'ਕੀਮਤ' },
        'health': { hi: 'स्वास्थ्य', pa: 'ਸਿਹਤ' },
        'immunity': { hi: 'रोग प्रतिरोधक क्षमता', pa: 'ਰੋਗ ਪ੍ਰਤੀਰੋਧਕ ਸ਼ਕਤੀ' },
        'digestion': { hi: 'पाचन', pa: 'ਪਾਚਨ' },
        'stress': { hi: 'तनाव', pa: 'ਤਣਾਅ' },
        'pain': { hi: 'दर्द', pa: 'ਦਰਦ' }
    };

    let localized = text;
    
    // Replace whole words from dictionary
    Object.entries(dictionary).forEach(([en, local]) => {
        const regex = new RegExp(`\\b${en}\\b`, 'gi');
        localized = localized.replace(regex, local[language] || en);
    });

    // Simple phonetic fallback for common Ayurvedic suffixes and patterns
    if (language === 'hi') {
        localized = localized
            .replace(/veda/gi, 'वेद')
            .replace(/veda/gi, 'वेदा')
            .replace(/home/gi, 'होम')
            .replace(/medi/gi, 'मेडी');
    } else if (language === 'pa') {
        localized = localized
            .replace(/veda/gi, 'ਵੇਦ')
            .replace(/home/gi, 'ਹੋਮ')
            .replace(/medi/gi, 'ਮੇਡੀ');
    }

    return localized;
}

/**
 * Heuristic: is this query likely about a product (vs. company/general info)?
 * Returns false for queries that are clearly not product searches.
 */
function isLikelyProductQuery(lowerQuery, tokens) {
    // ── Pre-check: Ayurvedic Keywords ──
    // If it contains a known Ayurvedic term, it's likely okay to search
    const ayurvedicTerms = [
        'ashwagandha', 'triphala', 'brahmi', 'shatavari', 'giloy', 'amla', 'shilajit', 
        'turmeric', 'haldi', 'curcumin', 'neem', 'tulsi', 'guggul', 'honey', 'capsule',
        'tablet', 'syrup', 'oil', 'powder', 'churna', 'rasa', 'bhasma',
        'अश्वगंधा', 'त्रिफला', 'ब्राह्मी', 'शतावरी', 'गिलोय', 'आंवला', 'शिलाजीत', 'हल्दी', 'तुलसी', 'चूर्ण',
        'ਅਸ਼ਵਗੰਧਾ', 'ਤ੍ਰਿਫਲਾ', 'ਬ੍ਰਾਹਮੀ', 'ਸ਼ਤਾਵਰੀ', 'ਗਿਲੋਏ', 'ਆਮਲਾ', 'ਸ਼ਿਲਾਜੀਤ', 'ਹਲਦੀ', 'ਤੁਲਸੀ',
        'नींद', 'दर्द', 'पाचन', 'तनाव', 'ਚਿੰਤਾ', 'ਦਰਦ', 'ਨੀਂਦ',
        'डाबर', 'च्यवनप्राश', 'ਡਾਬਰ', 'ਚਯਵਨਪ੍ਰਾਸ਼',
        'झंडू', 'हिमालय', 'पतंजलि', 'बैद्यनाथ', 'सिरप', 'गैस', 'एसिडिटी'
    ];
    const containsIndic = /[\u0900-\u097F\u0A00-\u0A7F]/.test(lowerQuery);
    const hasAyurvedicTerm = tokens.some(t => ayurvedicTerms.includes(t));
    if (hasAyurvedicTerm || containsIndic) return true;

    // ── Intent Check ──
    const { intent } = detectIntentFromTokens(tokens);
    const productIntents = ['product_search', 'product_info', 'product_listing', 'pricing_info', 'health_query'];
    const isExplicitProductIntent = productIntents.includes(intent);

    // If it's a short query and not an explicit product intent or ayurvedic term, block it
    if (tokens.length < 3 && !isExplicitProductIntent && !hasAyurvedicTerm) return false;

    // Patterns that signal a NON-product query — block product search for these
    const nonProductPatterns = [
        /who\s+(is|are|was|owns|founded|runs|leads)/i,
        /\b(owner|founder|ceo|director|president|chairman|manager|head)\b/i,
        /^(what|how|where|when|why)\s+(is|are|was|were|do|does)\b(?!.*(product|ayurveda|ayurvedic|medicine|tablet|syrup|oil|powder|capsule|brand))/i,
        /\b(is|are|was|were|do|does)\b.*\b(you|your|me|my)\b(?!.*(product|ayurveda|ayurvedic))/i,
        /tell\s+me\s+about\s+(homeved|mediveda|the\s+company|your\s+company)/i,
        /\b(when\s+was|when\s+did|how\s+many\s+employees|headquarters|location|address\s+of)\b/i,
    ];

    for (const pattern of nonProductPatterns) {
        if (pattern.test(lowerQuery)) return false;
    }

    return isExplicitProductIntent;
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
        /\b(दूसरा|अन्य|अलग|विकल्प|और)\b.*\b(उत्पाद|आइटम|चीज)/i,
        /(दिखाएं|दिखाओ|दिखाइए)\s+.*(और|दूसरा|अन्य)/i,
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
        // Hindi patterns
        /^(?:दिखाएं|दिखाओ|दिखाइए)\s+(?:सभी\s+)?(?:आपके\s+)?(?:उपलब्ध\s+)?(?:उत्पाद|आइटम)$/i,
        /^(?:सूची|लिस्ट)\s+(?:बनाएं|दिखाएं)\s+(?:सभी\s+)?(?:उत्पाद|आइटम)$/i,
        /^क्या\s+(?:उत्पाद|आइटम)\s+(?:उपलब्ध|हैं)/i,
        /^(?:सभी\s+)?उत्पाद$/i,
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
        // Hindi category patterns
        /(?:दिखाएं|दिखाओ|दिखाइए|खोजें)\s+(?:सभी\s+)?([\u0900-\u097F\w]+(?:\s+[\u0900-\u097F\w]+)?)\s+(?:उत्पाद|आइटम)/i,
        /([\u0900-\u097F\w]+(?:\s+[\u0900-\u097F\w]+)?)\s+(?:के\s+)?(?:उत्पाद|आइटम)/i,
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
 * @param {string} language   — preferred language ('en' or 'hi')
 */
exports.processQuery = async (query, sessionId = 'default', language = 'en') => {
    if (!query) {
        return {
            answer: language === 'hi' ? "क्षमा करें, मुझे इस बारे में अधिक जानकारी नहीं है।" : "Sorry, we don't have too much knowledge about that.",
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
                    ? (language === 'hi' ? `यहाँ आपके लिए कुछ वैकल्पिक "${session.lastKeyword}" उत्पाद हैं:` : `Here are some alternative "${session.lastKeyword}" products for you:`)
                    : (language === 'hi' ? `यहाँ कुछ अन्य उत्पाद हैं जो आपको पसंद आ सकते हैं:` : `Here are some other products you might like:`),
                intent: 'alternative_request',
                confidence: 1.0,
                products: alternatives
            };
        }

        return {
            answer: language === 'hi' 
                ? "क्षमा करें, मेरे पास अभी कोई और उत्पाद सुझाव नहीं हैं।\nकिसी अन्य उत्पाद या श्रेणी के बारे में पूछने का प्रयास करें!"
                : "Sorry, I don't have any more product suggestions right now.\nTry asking about a different product or category!",
            intent: 'alternative_request',
            confidence: 0.9,
            products: []
        };
    }

    // ── Stage 3: Greeting Detection ───────────────────────────────────────────
    const exactGreetings = ['hi', 'hello', 'hii', 'helo', 'hey', 'greetings', 'नमस्ते', 'नमस्कार', 'हेल्लो', 'हाय', 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ', 'ਹੈਲੋ'];
    const cleanLowerQuery = lowerQuery.replace(/[^a-z0-9\s\u0900-\u097F\u0A00-\u0A7F]/g, '').trim();
    if (exactGreetings.includes(lowerQuery) || exactGreetings.includes(cleanLowerQuery)) {
        return {
            answer: language === 'hi'
                ? "नमस्ते! मैं होमवेद हेल्थबॉट हूँ, आपका आयुर्वेदिक कल्याण सहायक। 🌿\nआज मैं आपकी कैसे मदद कर सकता हूँ? आप मुझसे इनके बारे में पूछ सकते हैं:\n• उत्पाद (जैसे \"अश्वगंधा\", \"त्रिफला\")\n• स्वास्थ्य विषय (जैसे \"तनाव से राहत\", \"प्रतिरक्षा\")\n• मूल्य निर्धारण, शिपिंग, रिटर्न या कंपनी की जानकारी"
                : "Hello! I'm HomeVed HealthBot, your Ayurvedic wellness assistant. 🌿\nHow can I help you today? You can ask me about:\n• Products (e.g. \"Ashwagandha\", \"Triphala\")\n• Health topics (e.g. \"stress relief\", \"immunity\")\n• Pricing, shipping, returns, or company info",
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
            let answer = language === 'hi' 
                ? `₹${minPrice} और ₹${maxPrice} के बीच के उत्पाद यहाँ दिए गए हैं:\n`
                : `Here are products between ₹${minPrice} and ₹${maxPrice}:\n`;
            filtered.slice(0, 5).forEach(p => { answer += `• ${p.name}: ₹${p.price}\n`; });
            if (filtered.length > 5) answer += language === 'hi' ? `...और ${filtered.length - 5} अधिक।` : `...and ${filtered.length - 5} more.`;
            setSession(sessionId, { lastProducts: filtered, lastKeyword: '', lastCategory: '' });
            return { answer: answer.trim(), intent: 'price_filter', confidence: 1.0, products: filtered };
        }
        return { 
            answer: language === 'hi' 
                ? `क्षमा करें, ₹${minPrice} और ₹${maxPrice} के बीच कोई उत्पाद उपलब्ध नहीं है।` 
                : `Sorry, no products available between ₹${minPrice} and ₹${maxPrice}.`, 
            intent: 'price_filter', 
            confidence: 1.0, 
            products: [] 
        };
    }

    if (underMatch) {
        const maxPrice = parseFloat(underMatch[1]);
        const priceProducts = await productService.chatbotSearchByPrice(maxPrice);
        if (priceProducts.length > 0) {
            let answer = language === 'hi'
                ? `₹${maxPrice} से कम के उत्पाद यहाँ दिए गए हैं:\n`
                : `Here are products under ₹${maxPrice}:\n`;
            priceProducts.slice(0, 5).forEach(p => { answer += `• ${p.name}: ₹${p.price}\n`; });
            if (priceProducts.length > 5) answer += language === 'hi' ? `...और ${priceProducts.length - 5} अधिक।` : `...and ${priceProducts.length - 5} more.`;
            setSession(sessionId, { lastProducts: priceProducts, lastKeyword: '', lastCategory: '' });
            return { answer: answer.trim(), intent: 'price_filter', confidence: 1.0, products: priceProducts };
        }
        return { 
            answer: language === 'hi'
                ? `क्षमा करें, ₹${maxPrice} से कम कोई उत्पाद उपलब्ध नहीं है।`
                : language === 'pa'
                ? `ਮਾਫ਼ ਕਰਨਾ, ₹${maxPrice} ਤੋਂ ਘੱਟ ਕੋਈ ਉਤਪਾਦ ਉਪਲਬਧ ਨਹੀਂ ਹੈ।`
                : `Sorry, no products available under ₹${maxPrice}.`, 
            intent: 'price_filter', 
            confidence: 1.0, 
            products: [] 
        };
    }

    if (aboveMatch) {
        const minPrice = parseFloat(aboveMatch[1]);
        const priceProducts = await productService.chatbotSearchByPriceAbove(minPrice);
        if (priceProducts.length > 0) {
            let answer = language === 'hi'
                ? `₹${minPrice} से ऊपर के उत्पाद यहाँ दिए गए हैं:\n`
                : `Here are products above ₹${minPrice}:\n`;
            priceProducts.slice(0, 5).forEach(p => { answer += `• ${p.name}: ₹${p.price}\n`; });
            if (priceProducts.length > 5) answer += language === 'hi' ? `...और ${priceProducts.length - 5} अधिक।` : `...and ${priceProducts.length - 5} more.`;
            setSession(sessionId, { lastProducts: priceProducts, lastKeyword: '', lastCategory: '' });
            return { answer: answer.trim(), intent: 'price_filter_above', confidence: 1.0, products: priceProducts };
        }
        return { 
            answer: language === 'hi'
                ? `क्षमा करें, ₹${minPrice} से ऊपर कोई उत्पाद उपलब्ध नहीं है।`
                : language === 'pa'
                ? `ਮਾਫ਼ ਕਰਨਾ, ₹${minPrice} ਤੋਂ ਉੱਪਰ ਕੋਈ ਉਤਪਾਦ ਉਪਲਬਧ ਨਹੀਂ ਹੈ।`
                : `Sorry, no products available above ₹${minPrice}.`, 
            intent: 'price_filter_above', 
            confidence: 1.0, 
            products: [] 
        };
    }

    // ── Stage 4.5: Product Listing Intent ────────────────────────────────────
    const listingIntent = detectProductListingIntent(lowerQuery);
    if (listingIntent) {
        let listProducts = [];
        let listAnswer;

        if (listingIntent.isGeneral) {
            listProducts = await productService.chatbotGetProducts(10);
            listAnswer = listProducts.length > 0
                ? (language === 'hi' 
                    ? `यहाँ हमारे उपलब्ध उत्पाद हैं (${listProducts.length} दिखा रहे हैं)। विवरण देखने के लिए किसी पर भी क्लिक करें:` 
                    : language === 'pa'
                    ? `ਇੱਥੇ ਸਾਡੇ ਉਪਲਬਧ ਉਤਪਾਦ ਹਨ (${listProducts.length} ਦਿਖਾ ਰਹੇ ਹਨ)। ਵੇਰਵੇ ਦੇਖਣ ਲਈ ਕਿਸੇ 'ਤੇ ਵੀ ਕਲਿੱਕ ਕਰੋ:`
                    : `Here are our available products (${listProducts.length} shown). Click any to view details:`)
                : null;
        } else {
            listProducts = await productService.chatbotSearchByCategory(listingIntent.keyword, 10);
            if (listProducts.length === 0) {
                listProducts = await productService.simpleChatbotSearch(listingIntent.keyword);
            }
            listAnswer = listProducts.length > 0
                ? (language === 'hi'
                    ? `यहाँ ${listProducts.length} "${listingIntent.keyword}" उत्पाद हैं जो मुझे मिले। विवरण देखने के लिए किसी पर भी क्लिक करें:`
                    : language === 'pa'
                    ? `ਇੱਥੇ ${listProducts.length} "${listingIntent.keyword}" ਉਤਪਾਦ ਹਨ ਜੋ ਮੈਨੂੰ ਮਿਲੇ ਹਨ। ਵੇਰਵੇ ਦੇਖਣ ਲਈ ਕਿਸੇ 'ਤੇ ਵੀ ਕਲਿੱਕ ਕਰੋ:`
                    : `Here are ${listProducts.length} "${listingIntent.keyword}" product${listProducts.length > 1 ? 's' : ''} I found. Click any to view details:`)
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

        if (listingIntent.isGeneral) {
            await logUnansweredQuery(sanitizedQuery, 'product_listing');
            return {
                answer: language === 'hi' 
                    ? "क्षमा करें, हमारे पास अभी उत्पाद उपलब्ध नहीं हैं।" 
                    : language === 'pa'
                    ? "ਮਾਫ਼ ਕਰਨਾ, ਸਾਡੇ ਕੋਲ ਇਸ ਸਮੇਂ ਉਤਪਾਦ ਉਪਲਬਧ ਨਹੀਂ ਹਨ।"
                    : "Sorry, we don't have products available right now.",
                intent: 'product_listing',
                confidence: 1.0,
                products: [],
            };
        }
    }

    // ── Stage 5: Company / People Info Guard ──────────────────────────────────
    const companyInfoPatterns = [
        {
            pattern: /(who\s+(is|are|was)\s+(the\s+)?(owner|founder|ceo|director|head|president|co-founder)|कौन\s+है\s+(मालिक|संस्थापक|प्रमुख))/i,
            answer: language === 'hi'
                ? "होमवेद एक कल्याणकारी कंपनी है जिसे एक उत्साही टीम द्वारा बनाया गया है जो हर घर में प्रामाणिक आयुर्वेदिक उत्पाद लाने के लिए समर्पित है।\n\nविशिष्ट नेतृत्व या स्वामित्व की जानकारी के लिए, कृपया हमारी आधिकारिक वेबसाइट देखें या support@mediveda.com पर हमसे संपर्क करें।\n📞 +91 1800-123-4567"
                : "HomeVed is a wellness company built by a passionate team dedicated to bringing authentic Ayurvedic products to every home.\n\nFor specific leadership or ownership information, please visit our official website or contact us at support@mediveda.com.\n📞 +91 1800-123-4567"
        },
        {
            pattern: /(\b(owner|founder|ceo|chairman|president|co-founder|director)\b.*\b(homeved|mediveda|company|of)\b|(मालिक|संस्थापक|प्रमुख).*(होमवेद|कंपनी))/i,
            answer: language === 'hi'
                ? "होमवेद की स्थापना और प्रबंधन आयुर्वेदिक कल्याण के प्रति उत्साही टीम द्वारा किया जाता है।\n\nनेतृत्व के विवरण के लिए, कृपया हमारे 'हमारे बारे में' (About) पृष्ठ पर जाएं या support@mediveda.com पर हमसे संपर्क करें।"
                : "HomeVed is founded and managed by a team passionate about Ayurvedic wellness.\n\nFor leadership details, please visit our About page or contact us at support@mediveda.com."
        },
        {
            pattern: /(\b(homeved|mediveda)\b.*\b(owner|founder|ceo|founded|established|started|created)\b|होमवेद.*(शुरू|बनाया|मालिक))/i,
            answer: language === 'hi'
                ? "होमवेद एक आयुर्वेदिक स्वास्थ्य और कल्याण मंच है जो प्रामाणिक, प्राकृतिक उत्पादों के लिए प्रतिबद्ध है।\n\nविशिष्ट कंपनी या नेतृत्व की जानकारी के लिए, कृपया हमसे support@mediveda.com या +91 1800-123-4567 पर संपर्क करें।"
                : "HomeVed is an Ayurvedic health & wellness platform committed to authentic, natural products.\n\nFor specific company or leadership information, please contact us at support@mediveda.com or +91 1800-123-4567."
        },
        {
            pattern: /(about\s+(homeved|mediveda|us|the\s+company|our\s+company)|(होमवेद|कंपनी|हमारे)\s+बारे\s+में)/i,
            answer: language === 'hi'
                ? "होमवेद के बारे में:\n\nमिशन: समग्र कल्याण के लिए आयुर्वेद के प्रामाणिक ज्ञान को हर घर में लाना।\nदृष्टि: प्राकृतिक, सुरक्षित और प्रभावी आयुर्वेदिक स्वास्थ्य देखभाल उत्पादों के लिए सबसे भरोसेमंद मंच बनना।\nसेवाएं: हम पारंपरिक स्वास्थ्य प्रथाओं पर विशेषज्ञ मार्गदर्शन के साथ उच्च गुणवत्ता वाले आयुर्वेदिक पूरक, त्वचा की देखभाल और कल्याण उत्पादों की एक विस्तृत श्रृंखला प्रदान करते हैं।\n\nसंपर्क करें: support@mediveda.com | +91 1800-123-4567"
                : "About HomeVed:\n\nMission: To bring the authentic wisdom of Ayurveda to every home for holistic well-being.\nVision: To become the most trusted platform for natural, safe, and effective Ayurvedic healthcare products.\nServices: We offer a curated range of high-quality Ayurvedic supplements, skincare, and wellness products, along with expert guidance on traditional health practices.\n\nContact us: support@mediveda.com | +91 1800-123-4567"
        },
        {
            pattern: /(what\s+(is|are)\s+(homeved|mediveda)|(होमवेद|मेडिवेद)\s+क्या\s+है|(ਹੋਮਵੇਦ|ਮੇਡੀਵੇਦਾ)\s+ਕੀ\s+ਹੈ)/i,
            answer: language === 'hi'
                ? "होमवेद (Mediveda) एक भरोसेमंद आयुर्वेदिक कल्याण मंच है जो प्रदान करता है:\n• 100% प्राकृतिक और प्रामाणिक उत्पाद\n• पारंपरिक आयुर्वेदिक फॉर्मूलेशन\n• गुणवत्ता-परीक्षणित पूरक\n• विशेषज्ञ कल्याण मार्गदर्शन\n\nअधिक जानने के लिए हमारे 'हमारे बारे में' (About) पृष्ठ पर जाएं!"
                : language === 'pa'
                ? "ਹੋਮਵੇਦ (Mediveda) ਇੱਕ ਭਰੋਸੇਮੰਦ ਆਯੁਰਵੈਦਿਕ ਤੰਦਰੁਸਤੀ ਪਲੇਟਫਾਰਮ ਹੈ ਜੋ ਪੇਸ਼ ਕਰਦਾ ਹੈ:\n• 100% ਕੁਦਰਤੀ ਅਤੇ ਪ੍ਰਮਾਣਿਕ ਉਤਪਾਦ\n• ਰਵਾਇਤੀ ਆਯੁਰਵੈਦਿਕ ਫਾਰਮੂਲੇਸ਼ਨ\n• ਗੁਣਵੱਤਾ-ਪ੍ਰੀਖਿਆ ਪੂਰਕ\n• ਮਾਹਿਰ ਤੰਦਰੁਸਤੀ ਮਾਰਗਦਰਸ਼ਨ\n\nਹੋਰ ਜਾਣਨ ਲਈ ਸਾਡੇ 'ਸਾਡੇ ਬਾਰੇ' (About) ਪੰਨੇ 'ਤੇ ਜਾਓ!"
                : "HomeVed (Mediveda) is a trusted Ayurvedic wellness platform offering:\n• 100% natural and authentic products\n• Traditional Ayurvedic formulations\n• Quality-tested supplements\n• Expert wellness guidance\n\nVisit our About page to learn more!"
        },
    ];
    // ── Stage 5.5: Inventory Count Queries (NEW) ───────────────────────────────
    const isHowMany = lowerQuery.includes('how many') || lowerQuery.includes('total') || lowerQuery.includes('list of all') || lowerQuery.includes('count') || lowerQuery.includes('कितने') || lowerQuery.includes('कुल');
    const mentionsProducts = lowerQuery.includes('product') || lowerQuery.includes('उत्पाद');
    const mentionsCategories = lowerQuery.includes('categor') || lowerQuery.includes('श्रेणी');

    if (isHowMany && mentionsProducts && !mentionsCategories) {
        try {
            const countRes = await pool.query('SELECT COUNT(*) FROM products WHERE active = true');
            const total = countRes.rows[0].count;
            return {
                answer: language === 'hi'
                    ? `हमारे पास कुल ${total} प्रीमियम आयुर्वेदिक उत्पाद उपलब्ध हैं। आप विशिष्ट वस्तुओं की खोज कर सकते हैं या मुझसे श्रेणी के अनुसार उत्पादों को सूचीबद्ध करने के लिए कह सकते हैं!`
                    : `We have a total of ${total} premium Ayurvedic products available. You can search for specific items or ask me to list products by category!`,
                intent: 'inventory_info',
                confidence: 1.0,
                products: []
            };
        } catch (e) { /* fall through */ }
    }

    if (isHowMany && mentionsCategories) {
        try {
            const countRes = await pool.query('SELECT COUNT(*) FROM category WHERE active = true');
            const total = countRes.rows[0].count;
            const namesRes = await pool.query('SELECT name FROM category WHERE active = true ORDER BY name LIMIT 6');
            const names = namesRes.rows.map(r => r.name).join(', ');
            return {
                answer: language === 'hi'
                    ? `हमारे पास आयुर्वेदिक कल्याण उत्पादों की ${total} श्रेणियां हैं, जिनमें ${names} और बहुत कुछ शामिल हैं। आपकी किस श्रेणी में रुचि है?`
                    : `We have ${total} categories of Ayurvedic wellness products, including ${names}, and more. Which category are you interested in?`,
                intent: 'inventory_info',
                confidence: 1.0,
                products: []
            };
        } catch (e) { /* fall through */ }
    }

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
            answer: language === 'hi'
                ? "गोपनीयता नीति (Privacy Policy):\n\nहोमवेद आपकी गोपनीयता की रक्षा के लिए प्रतिबद्ध है। हम आपकी व्यक्तिगत जानकारी (जैसे नाम, ईमेल और पता) केवल आपके आदेशों को संसाधित करने और आपके खरीदारी अनुभव को बेहतर बनाने के लिए एकत्र और उपयोग करते हैं। हम विपणन उद्देश्यों के लिए तीसरे पक्ष के साथ आपका डेटा नहीं बेचते या साझा नहीं करते हैं। सभी लेनदेन उद्योग-मानक एन्क्रिप्शन के साथ सुरक्षित हैं।"
                : language === 'pa'
                ? "ਗੋਪਨੀਯਤਾ ਨੀਤੀ (Privacy Policy):\n\nਹੋਮਵੇਦ ਤੁਹਾਡੀ ਗੋਪਨੀਯਤਾ ਦੀ ਰੱਖਿਆ ਲਈ ਵਚਨਬੱਧ ਹੈ। ਅਸੀਂ ਤੁਹਾਡੀ ਨਿੱਜੀ ਜਾਣਕਾਰੀ (ਜਿਵੇਂ ਕਿ ਨਾਮ, ਈਮੇਲ ਅਤੇ ਪਤਾ) ਸਿਰਫ਼ ਤੁਹਾਡੇ ਆਰਡਰਾਂ ਦੀ ਪ੍ਰਕਿਰਿਆ ਕਰਨ ਅਤੇ ਤੁਹਾਡੇ ਖਰੀਦਦਾਰੀ ਅਨੁਭਵ ਨੂੰ ਬਿਹਤਰ ਬਣਾਉਣ ਲਈ ਇਕੱਤਰ ਕਰਦੇ ਅਤੇ ਵਰਤਦੇ ਹਾਂ। ਅਸੀਂ ਮਾਰਕੀਟਿੰਗ ਉਦੇਸ਼ਾਂ ਲਈ ਤੀਜੀ ਧਿਰਾਂ ਨਾਲ ਤੁਹਾਡਾ ਡੇਟਾ ਵੇਚਦੇ ਜਾਂ ਸਾਂਝਾ ਨਹੀਂ ਕਰਦੇ ਹਾਂ। ਸਾਰੇ ਲੈਣ-ਦੇਣ ਉਦਯੋਗ-ਮਿਆਰੀ ਐਨਕ੍ਰਿਪਸ਼ਨ ਨਾਲ ਸੁਰੱਖਿਅਤ ਹਨ।"
                : "Privacy Policy:\n\nHomeVed is committed to protecting your privacy. We collect and use your personal information (such as name, email, and address) solely to process your orders and improve your shopping experience. We do not sell or share your data with third parties for marketing purposes. All transactions are secured with industry-standard encryption.",
            intent: 'navigation'
        },
        {
            pattern: /return\s*policy|refund\s*policy/i,
            answer: language === 'hi'
                ? "वापसी नीति (Return Policy):\n\nहम चाहते हैं कि आप अपनी खरीदारी से पूरी तरह संतुष्ट हों। यदि आप किसी उत्पाद से खुश नहीं हैं, तो आप उसे वितरण के 7 दिनों के भीतर वापस कर सकते हैं। वस्तु अप्रयुक्त (unused), अपनी मूल पैकेजिंग में और सभी टैगों के साथ होनी चाहिए। 5-7 व्यावसायिक दिनों के भीतर आपके मूल भुगतान माध्यम में पूर्ण धनवापसी (refund) संसाधित की जाएगी।"
                : language === 'pa'
                ? "ਵਾਪਸੀ ਨੀਤੀ (Return Policy):\n\nਅਸੀਂ ਚਾਹੁੰਦੇ ਹਾਂ ਕਿ ਤੁਸੀਂ ਆਪਣੀ ਖਰੀਦ ਤੋਂ ਪੂਰੀ ਤਰ੍ਹਾਂ ਸੰਤੁਸ਼ਟ ਹੋਵੋ। ਜੇਕਰ ਤੁਸੀਂ ਕਿਸੇ ਉਤਪਾਦ ਤੋਂ ਖੁਸ਼ ਨਹੀਂ ਹੋ, ਤਾਂ ਤੁਸੀਂ ਉਸਨੂੰ ਡਿਲੀਵਰੀ ਦੇ 7 ਦਿਨਾਂ ਦੇ ਅੰਦਰ ਵਾਪਸ ਕਰ ਸਕਦੇ ਹੋ। ਵਸਤੂ ਅਣਵਰਤੀ (unused), ਆਪਣੀ ਅਸਲ ਪੈਕੇਜਿੰਗ ਵਿੱਚ ਅਤੇ ਸਾਰੇ ਟੈਗਾਂ ਦੇ ਨਾਲ ਹੋਣੀ ਚਾਹੀਦੀ ਹੈ। 5-7 ਕੰਮਕਾਜੀ ਦਿਨਾਂ ਦੇ ਅੰਦਰ ਤੁਹਾਡੇ ਅਸਲ ਭੁਗਤਾਨ ਵਿਧੀ ਵਿੱਚ ਪੂਰੀ ਰਿਫੰਡ (refund) ਦੀ ਪ੍ਰਕਿਰਿਆ ਕੀਤੀ ਜਾਵੇਗੀ।"
                : "Return Policy:\n\nWe want you to be completely satisfied with your purchase. If you're not happy with a product, you can return it within 7 days of delivery. The item must be unused, in its original packaging, and with all tags intact. A full refund will be processed back to your original payment method within 5-7 business days.",
            intent: 'navigation'
        },
        {
            pattern: /login|sign\s*in|how\s*to\s*login/i,
            answer: language === 'hi'
                ? "होमवेद में लॉगिन करने के लिए:\n1. होमवेद वेबसाइट पर जाएं।\n2. ऊपर दाईं ओर 'अकाउंट' (Account) आइकन या 'लॉगिन' (Login) बटन पर क्लिक करें।\n3. अपना पंजीकृत ईमेल और पासवर्ड दर्ज करें।\n4. अपने खाते तक पहुँचने के लिए 'सबमिट' (Submit) या 'लॉगिन' पर क्लिक करें।\n5. यदि आप अपना पासवर्ड भूल गए हैं, तो 'फॉरगॉट पासवर्ड' (Forgot Password) विकल्प का उपयोग करें।"
                : "To login to HomeVed:\n1. Go to the HomeVed website.\n2. Click on the 'Account' icon or 'Login' button at the top right.\n3. Enter your registered email and password.\n4. Click 'Submit' or 'Login' to access your account.\n5. If you forgot your password, use the 'Forgot Password' option.",
            intent: 'navigation'
        },
        {
            pattern: /how\s*(to\s*)?order|place\s*(an?\s*)?order|ordering|how\s*to\s*buy/i,
            answer: language === 'hi'
                ? "ऑर्डर करना आसान है! 🛒\n1. हमारे उत्पादों को ब्राउज़ करें\n2. अपनी पसंद की वस्तुओं पर 'कार्ट में जोड़ें' (Add to Cart) पर क्लिक करें\n3. कार्ट में जाएं और 'चेकआउट' (Checkout) पर क्लिक करें\n4. अपना शिपिंग विवरण दर्ज करें\n5. सुरक्षित रूप से भुगतान पूरा करें\n\nकिसी विशिष्ट कदम में मदद चाहिए?"
                : language === 'pa'
                ? "ਆਰਡਰ ਕਰਨਾ ਆਸਾਨ ਹੈ! 🛒\n1. ਸਾਡੇ ਉਤਪਾਦਾਂ ਨੂੰ ਬ੍ਰਾਊਜ਼ ਕਰੋ\n2. ਆਪਣੀ ਪਸੰਦ ਦੀਆਂ ਵਸਤੂਆਂ 'ਤੇ 'ਕਾਰਟ ਵਿੱਚ ਜੋੜੋ' (Add to Cart) 'ਤੇ ਕਲਿੱਕ ਕਰੋ\n3. ਕਾਰਟ ਵਿੱਚ ਜਾਓ ਅਤੇ 'ਚੈੱਕਆਉਟ' (Checkout) 'ਤੇ ਕਲਿੱਕ ਕਰੋ\n4. ਆਪਣੇ ਸ਼ਿਪਿੰਗ ਵੇਰਵੇ ਦਰਜ ਕਰੋ\n5. ਸੁਰੱਖਿਅਤ ਢੰਗ ਨਾਲ ਭੁਗਤਾਨ ਪੂਰਾ ਕਰੋ\n\nਕਿਸੇ ਖਾਸ ਕਦਮ ਵਿੱਚ ਮਦਦ ਚਾਹੀਦੀ ਹੈ?"
                : "Ordering is easy! 🛒\n1. Browse our products\n2. Click 'Add to Cart' on items you like\n3. Go to Cart and click 'Checkout'\n4. Enter your shipping details\n5. Complete payment securely\n\nNeed help with a specific step?",
            intent: 'navigation'
        },
        {
            pattern: /shipping|delivery|how\s*long/i,
            answer: language === 'hi'
                ? "शिपिंग जानकारी:\n• सभी ऑर्डर पर मुफ़्त डिलीवरी\n• 5-7 व्यावसायिक दिनों के भीतर वितरण\n• 'मेरे आदेश' (My Orders) से कभी भी अपने ऑर्डर को ट्रैक करें\n• प्रामाणिक उत्पादों की गारंटी"
                : language === 'pa'
                ? "ਸ਼ਿਪਿੰਗ ਜਾਣਕਾਰੀ:\n• ਸਾਰੇ ਆਰਡਰਾਂ 'ਤੇ ਮੁਫ਼ਤ ਡਿਲੀਵਰੀ\n• 5-7 ਕੰਮਕਾਜੀ ਦਿਨਾਂ ਦੇ ਅੰਦਰ ਡਿਲੀਵਰੀ\n• 'ਮੇਰੇ ਆਰਡਰ' (My Orders) ਤੋਂ ਕਿਸੇ ਵੀ ਸਮੇਂ ਆਪਣੇ ਆਰਡਰ ਨੂੰ ਟ੍ਰੈਕ ਕਰੋ\n• ਪ੍ਰਮਾਣਿਕ ਉਤਪਾਦਾਂ ਦੀ ਗਰੰਟੀ"
                : "Shipping Information:\n• FREE delivery on all orders\n• Delivery within 5-7 business days\n• Track your order anytime from 'My Orders'\n• Authentic products guaranteed",
            intent: 'navigation'
        },
        {
            pattern: /contact|support|email|phone|call\s*us/i,
            answer: language === 'hi'
                ? "हमसे संपर्क करें:\n📧 ईमेल: support@mediveda.com\n📞 फोन: +91 1800-123-4567\n⏰ समय: सोम-शनि, सुबह 9 बजे - शाम 6 बजे\n\nहम आमतौर पर 24 घंटों के भीतर जवाब देते हैं!"
                : language === 'pa'
                ? "ਸਾਡੇ ਨਾਲ ਸੰਪਰਕ ਕਰੋ:\n📧 ਈਮੇਲ: support@mediveda.com\n📞 ਫ਼ੋਨ: +91 1800-123-4567\n⏰ ਸਮਾਂ: ਸੋਮ-ਸ਼ਨਿ, ਸਵੇਰੇ 9 ਵਜੇ - ਸ਼ਾਮ 6 ਵਜੇ\n\nਅਸੀਂ ਆਮ ਤੌਰ 'ਤੇ 24 ਘੰਟਿਆਂ ਦੇ ਅੰਦਰ ਜਵਾਬ ਦਿੰਦੇ ਹਾਂ!"
                : "Contact Us:\n📧 Email: support@mediveda.com\n📞 Phone: +91 1800-123-4567\n⏰ Hours: Mon-Sat, 9 AM – 6 PM\n\nWe typically respond within 24 hours!",
            intent: 'contact_info'
        },
        {
            pattern: /payment|pay|payment\s*method/i,
            answer: language === 'hi'
                ? "स्वीकार किए गए भुगतान के तरीके:\n• क्रेडिट / डेबिट कार्ड\n• UPI (Google Pay, PhonePe, आदि)\n• नेट बैंकिंग\n• डिजिटल वॉलेट\n\nसभी भुगतान 100% सुरक्षित और एन्क्रिप्टेड हैं। 🔒"
                : language === 'pa'
                ? "ਭੁਗਤਾਨ ਦੇ ਤਰੀਕੇ:\n• ਕ੍ਰੈਡਿਟ / ਡੈਬਿਟ ਕਾਰਡ\n• UPI (Google Pay, PhonePe, ਆਦਿ)\n• ਨੈੱਟ ਬੈਂਕਿੰਗ\n• ਡਿਜੀਟਲ ਵਾਲਿਟ\n\nਸਾਰੇ ਭੁਗਤਾਨ 100% ਸੁਰੱਖਿਅਤ ਅਤੇ ਐਨਕ੍ਰਿਪਟਡ ਹਨ। 🔒"
                : "Payment Methods Accepted:\n• Credit / Debit Cards\n• UPI (Google Pay, PhonePe, etc.)\n• Net Banking\n• Digital Wallets\n\nAll payments are 100% secure and encrypted. 🔒",
            intent: 'navigation'
        },
        {
            pattern: /return|refund|exchange/i,
            answer: language === 'hi'
                ? "वापसी और धनवापसी नीति:\n• वितरण से 7 दिन की वापसी अवधि\n• वस्तुएं अप्रयुक्त और मूल पैकेजिंग में होनी चाहिए\n• वापसी शुरू करने के लिए support@mediveda.com पर संपर्क करें\n• 5-7 व्यावसायिक दिनों के भीतर पूर्ण धनवापसी संसाधित की जाएगी"
                : language === 'pa'
                ? "ਵਾਪਸੀ ਅਤੇ ਰਿਫੰਡ ਨੀਤੀ:\n• ਡਿਲੀਵਰੀ ਤੋਂ 7-ਦਿਨਾਂ ਦੀ ਵਾਪਸੀ ਦੀ ਮਿਆਦ\n• ਵਸਤੂਆਂ ਅਣਵਰਤੀਆਂ ਅਤੇ ਅਸਲ ਪੈਕੇਜਿੰਗ ਵਿੱਚ ਹੋਣੀਆਂ ਚਾਹੀਦੀਆਂ ਹਨ\n• ਵਾਪਸੀ ਸ਼ੁਰੂ ਕਰਨ ਲਈ support@mediveda.com 'ਤੇ ਸੰਪਰਕ ਕਰੋ\n• 5-7 ਕੰਮਕਾਜੀ ਦਿਨਾਂ ਦੇ ਅੰਦਰ ਪੂਰੀ ਰਿਫੰਡ ਦੀ ਪ੍ਰਕਿਰਿਆ ਕੀਤੀ ਜਾਵੇਗੀ"
                : "Return & Refund Policy:\n• 7-day return window from delivery\n• Items must be unused and in original packaging\n• Contact support@mediveda.com to initiate a return\n• Full refund processed within 5-7 business days",
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
    // Create a "shadow query" by normalizing keywords to English for matching against English patterns
    const shadowQuery = tokens.map(t => normalizeKeyword(t)).join(' ');
    
    // We try to match the original query OR the normalized shadow query
    const knowledgeSql = `
        SELECT * FROM chatbot_knowledge 
        WHERE is_approved = true AND (
            $1 ~* ('\\y(' || query_pattern || ')\\y') OR
            $2 ~* ('\\y(' || query_pattern || ')\\y')
        )
        ORDER BY confidence_score DESC
        LIMIT 1
    `;
    try {
        const knowledgeResult = await pool.query(knowledgeSql, [sanitizedQuery, shadowQuery]);

        if (knowledgeResult.rows.length > 0) {
            const entry = knowledgeResult.rows[0];

            // If we are in Hindi/Punjabi mode, we should ideally translate the answer
            // but for now we will provide a localized prefix if it's a known product category
            let answer = entry.answer;
            
            // Simple translation for common health topics in knowledge base
            if (language === 'hi' || language === 'pa') {
                answer = localizeText(answer, language);
            }

            // Increment usage count asynchronously
            pool.query(
                'UPDATE chatbot_knowledge SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = $1',
                [entry.id]
            ).catch(() => { });

            let products = [];
            // Use the provided keyword from DB, or extract from query if it's long enough.
            const keyword = entry.keywords && entry.keywords.length > 0
                ? entry.keywords[0]
                : (sanitizedQuery.length > 3 ? sanitizedQuery : null);

            // Fetch products if there is any meaningful keyword associated with the knowledge base entry.
            // This ensures questions about "immunity" will suggest immunity products alongside the helpful answer.
            if (keyword) {
                products = await productService.simpleChatbotSearch(keyword);

                // If the direct keyword failed, but this was a product intent, try again with the sanitized query
                if (products.length === 0 && (entry.intent === 'product_info' || entry.intent === 'product_search')) {
                    products = await productService.simpleChatbotSearch(sanitizedQuery);
                }

                if (products.length > 0) {
                    setSession(sessionId, {
                        lastProducts: products,
                        lastKeyword: keyword,
                        lastCategory: products[0]?.category || ''
                    });
                }
            }

            return {
                answer: answer,
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
        let directProducts = await productService.simpleChatbotSearch(sanitizedQuery);
        
        // If Hindi/Punjabi, try searching with shadow query too
        if (directProducts.length === 0 && shadowQuery && shadowQuery !== sanitizedQuery) {
            directProducts = await productService.simpleChatbotSearch(shadowQuery);
        }

        if (directProducts.length > 0) {
            setSession(sessionId, {
                lastProducts: directProducts,
                lastKeyword: shadowQuery || sanitizedQuery,
                lastCategory: directProducts[0]?.category || ''
            });
            return {
                answer: language === 'hi'
                    ? `मुझे "${localizeText(shadowQuery || sanitizedQuery, 'hi')}" से मेल खाने वाले ${directProducts.length} उत्पाद मिले:`
                    : language === 'pa'
                    ? `ਮੈਨੂੰ "${localizeText(shadowQuery || sanitizedQuery, 'pa')}" ਨਾਲ ਮੇਲ ਖਾਂਦੇ ${directProducts.length} ਉਤਪਾਦ ਮਿਲੇ ਹਨ:`
                    : `I found ${directProducts.length} product${directProducts.length > 1 ? 's' : ''} matching "${sanitizedQuery}":`,
                intent: 'product_search',
                confidence: 1.0,
                products: directProducts
            };
        }

        // Stage 9: Keyword-level product search
        if (keywords.length > 0) {
            for (const rawKw of keywords) {
                const kw = normalizeKeyword(rawKw);
                const kwProducts = await productService.simpleChatbotSearch(kw);
                if (kwProducts.length > 0) {
                    setSession(sessionId, {
                        lastProducts: kwProducts,
                        lastKeyword: kw,
                        lastCategory: kwProducts[0]?.category || ''
                    });
                    return {
                        answer: language === 'hi'
                            ? `यहाँ "${rawKw}" (${localizeText(kw, 'hi')}) से संबंधित उत्पाद दिए गए हैं:`
                            : language === 'pa'
                            ? `ਇੱਥੇ "${rawKw}" (${localizeText(kw, 'pa')}) ਨਾਲ ਸਬੰਧਤ ਉਤਪਾਦ ਹਨ:`
                            : `Here are products related to "${rawKw}":`,
                        intent: 'product_search',
                        confidence: 0.85,
                        products: kwProducts
                    };
                }
            }
        }

        // Stage 10: Fuzzy product search — RAISED threshold to 0.45 to reduce false positives
        const fuzzySql = `
            SELECT product_id, productname, word_similarity($1, productname) AS score
            FROM products
            WHERE active = true AND word_similarity($1, productname) > 0.45
            ORDER BY score DESC
            LIMIT 1
        `;
        try {
            // Try fuzzy search with original query AND shadow query
            let fuzzyResult = await pool.query(fuzzySql, [sanitizedQuery]);
            if ((!fuzzyResult.rows.length || fuzzyResult.rows[0].score < 0.45) && shadowQuery && shadowQuery !== sanitizedQuery) {
                const shadowFuzzy = await pool.query(fuzzySql, [shadowQuery]);
                if (shadowFuzzy.rows.length > 0 && shadowFuzzy.rows[0].score > 0.45) {
                    fuzzyResult = shadowFuzzy;
                }
            }

            if (fuzzyResult.rows.length > 0 && fuzzyResult.rows[0].score > 0.45) {
                const suggestedName = fuzzyResult.rows[0].productname;
                const matchedProducts = await productService.simpleChatbotSearch(suggestedName);

                if (matchedProducts.length > 0) {
                    setSession(sessionId, {
                        lastProducts: matchedProducts,
                        lastKeyword: suggestedName,
                        lastCategory: matchedProducts[0]?.category || ''
                    });
                    return {
                        answer: language === 'hi'
                            ? `क्या आपका मतलब "${localizeText(suggestedName, 'hi')}" था? यहाँ मुझे जो मिला वह है:`
                            : language === 'pa'
                            ? `ਕੀ ਤੁਹਾਡਾ ਮਤਲਬ "${localizeText(suggestedName, 'pa')}" ਸੀ? ਇੱਥੇ ਮੈਨੂੰ ਜੋ ਮਿਲਿਆ ਉਹ ਹੈ:`
                            : `Did you mean "${suggestedName}"? Here's what I found:`,
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
        answer: language === 'hi'
            ? "मुझे क्षमा करें, लेकिन वह उत्तर मेरे ज्ञान में नहीं है। मैं आयुर्वेद और होमवेद उत्पादों में विशेषज्ञता रखता हूँ।"
            : language === 'pa'
            ? "ਮੈਨੂੰ ਮਾਫ਼ ਕਰੋ, ਪਰ ਉਹ ਜਵਾਬ ਮੇਰੇ ਗਿਆਨ ਵਿੱਚ ਨਹੀਂ ਹੈ। ਮੈਂ ਆਯੁਰਵੇਦ ਅਤੇ ਹੋਮਵੇਦ ਉਤਪਾਦਾਂ ਵਿੱਚ ਮੁਹਾਰਤ ਰੱਖਦਾ ਹਾਂ।"
            : "I am sorry, but that answer is not in my knowledge based. I specialize in Ayurveda and Homeved products.",
        intent: 'fallback',
        confidence: 0.0,
        products: []
    };
};

/**
 * Log queries that didn't get a specific match to a database table for review.
 */
async function logUnansweredQuery(query, intent) {
    try {
        const sql = `
            INSERT INTO unanswered_queries (query_text, detected_intent, created_at)
            VALUES ($1, $2, NOW())
        `;
        await pool.query(sql, [query, intent]);
    } catch (err) {
        // Silently fail if table doesn't exist or other DB error
        console.error('Log unanswered query error:', err.message);
    }
}

// ─── Smart Search Wrapper ───────────────────────────────────────────────────

/**
 * processSmartSearch
 * Uses the NLP pipeline but injects previous results array directly into 
 * the session context so that stateless API calls can still use 
 * conversational features like "show other options".
 */
exports.processSmartSearch = async (query, previousResults = []) => {
    if (!query) return { answer: null, intent: 'fallback', products: [] };

    const sessionId = `smartsearch_${Date.now()}_${Math.random()}`;

    // Try to resolve category from previous items to aid alternative requests
    let lastCategory = '';
    if (previousResults && previousResults.length > 0) {
        try {
            const firstId = previousResults[0];
            // ID might be passed as int or string, handles both
            const result = await pool.query(
                'SELECT c.name as category_name FROM products p LEFT JOIN category c ON p.category_id = c.category_id WHERE p.product_id = $1',
                [firstId]
            );
            if (result.rows.length > 0) {
                lastCategory = result.rows[0].category_name || '';
            }
        } catch (e) { }
    }

    // Seed temporary session
    setSession(sessionId, {
        lastProducts: previousResults.map(id => ({ id: id.toString() })),
        lastKeyword: '',
        lastCategory: lastCategory
    });

    const result = await exports.processQuery(query, sessionId);

    // Clean up immediately for statelessness
    sessionStore.delete(sessionId);

    return result;
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
exports.localizeText = localizeText;
exports._nlpHelpers = {
    tokenize,
    extractKeywords,
    detectIntentFromTokens,
    isLikelyProductQuery,
    isAlternativeRequest,
    localizeText,
};
