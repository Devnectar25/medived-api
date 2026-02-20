const chatbotService = require('../services/chatbotService');

/**
 * Process chatbot query using the full NLP pipeline
 */
exports.processQuery = async (req, res) => {
    try {
        const { query, sessionId } = req.body;

        if (!query || query.trim().length < 1) {
            return res.json({
                success: false,
                message: "Please provide a question or search term."
            });
        }

        console.log('📝 NLP chatbot query:', query);

        // Run the NLP pipeline
        const result = await chatbotService.processQuery(query, sessionId);

        if (!result) {
            throw new Error("Chatbot service returned no result");
        }

        // Map products for frontend consistency
        const mappedProducts = (result.products || []).map(p => ({
            id: p.id,
            name: p.name,
            price: p.price,
            description: p.shortDescription || p.description,
            availability: p.inStock ? "In Stock" : "Out of Stock",
            image: p.image,
            rating: p.rating,
            inStock: p.inStock
        }));

        const wasSuccessful = result.intent !== 'fallback';

        // Log the query asynchronously (fire-and-forget)
        chatbotService.logQuery({
            userQuery: query,
            matchedPattern: result.suggestion || '',
            intent: result.intent,
            response: result.answer,
            confidence: result.confidence,
            wasSuccessful,
            sessionId: sessionId || 'default'
        }).catch(err => console.error('Logging failed:', err));

        return res.json({
            success: true,
            data: {
                answer: result.answer,
                intent: result.intent,
                confidence: result.confidence,
                products: mappedProducts,
                sessionId: sessionId || 'default',
                suggestion: result.suggestion || null,
                wasSuccessful
            }
        });

    } catch (error) {
        console.error("❌ Chatbot Query Error:", error);
        return res.status(500).json({
            success: false,
            message: "I'm having trouble processing your request. Please try again.",
            data: {
                answer: "Sorry, we don't have too much knowledge about that.",
                intent: 'error',
                confidence: 0.0,
                products: []
            }
        });
    }
};

/**
 * Submit user feedback for a chatbot response
 */
exports.submitFeedback = async (req, res) => {
    try {
        const { queryLogId, feedback } = req.body;
        if (queryLogId && feedback) {
            const pool = require('../config/db');
            await pool.query(
                'UPDATE chatbot_query_logs SET user_feedback = $1 WHERE id = $2',
                [feedback, queryLogId]
            );
        }
        return res.json({ success: true, message: "Feedback received. Thank you!" });
    } catch (err) {
        console.error('Feedback error:', err);
        return res.json({ success: true, message: "Feedback received." });
    }
};

/**
 * Get query suggestions (autocomplete)
 */
exports.getSuggestions = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) {
            return res.json({ success: true, suggestions: [] });
        }
        const pool = require('../config/db');
        const result = await pool.query(
            `SELECT DISTINCT user_query FROM chatbot_query_logs
             WHERE user_query ILIKE $1 AND was_successful = true
             ORDER BY user_query LIMIT 5`,
            [`%${q}%`]
        );
        return res.json({
            success: true,
            suggestions: result.rows.map(r => r.user_query)
        });
    } catch (err) {
        console.error('Suggestions error:', err);
        return res.json({ success: true, suggestions: [] });
    }
};

/**
 * Log product click from chatbot
 */
exports.logProductClick = async (req, res) => {
    try {
        const { productId, productName, sessionId } = req.body;
        if (productId) {
            chatbotService.logProductClick(productId, productName, sessionId || 'default');
        }
        return res.json({ success: true });
    } catch (err) {
        console.error('Click logging error:', err);
        return res.json({ success: true }); // Still return success to frontend
    }
};
