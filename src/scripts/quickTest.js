// Quick test for chatbot using native fetch if available
const http = require('http');

async function testQuery(query) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ query });

        const options = {
            hostname: 'localhost',
            port: 4000,
            path: '/api/chatbot/query',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                console.log(`\nQuery: "${query}"`);
                console.log(`Status: ${res.statusCode}`);
                try {
                    const result = JSON.parse(body);
                    console.log(`Response:`, JSON.stringify(result, null, 2));
                    resolve(result);
                } catch (e) {
                    console.log('Raw Response:', body);
                    resolve(body);
                }
            });
        });

        req.on('error', (error) => {
            console.error(`Error testing "${query}":`, error.message);
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

async function runTests() {
    console.log('Testing Chatbot NLP...\n');
    try {
        await testQuery('hello');
        await testQuery('what is ashwagandha?');
        await testQuery('how to order?');
        await testQuery('show me product under 1000');
        await testQuery('sugar free products');
        await testQuery('random gibberish');
    } catch (e) {
        console.error('Test run failed:', e.message);
    }
}

runTests();
