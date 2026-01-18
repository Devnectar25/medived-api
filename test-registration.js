// Test script for registration and OTP verification
const API_BASE = 'http://localhost:4000/api';

async function testRegistrationFlow() {
    console.log('=== Testing Registration Flow ===\n');

    const testEmail = `test${Date.now()}@example.com`;
    const testPassword = 'Test@1234';

    // Test 1: Register
    console.log('1. Testing Registration...');
    try {
        const registerResponse = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                password: testPassword,
                fullName: 'Test User',
                phone: '+1234567890'
            })
        });

        const registerData = await registerResponse.json();
        console.log('Register Response:', JSON.stringify(registerData, null, 2));

        if (registerData.success && registerData.requiresVerification) {
            console.log('\n✅ Registration successful - Verification required');
            console.log(`📧 Email: ${registerData.email}`);
            console.log(`🔑 OTP: ${registerData.otp}`);

            // Test 2: Verify OTP with correct code
            console.log('\n2. Testing OTP Verification with correct code...');

            const verifyResponse = await fetch(`${API_BASE}/auth/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: registerData.email,
                    otp: registerData.otp
                })
            });

            const verifyData = await verifyResponse.json();
            console.log('Verify Response Status:', verifyResponse.status);
            console.log('Verify Response:', JSON.stringify(verifyData, null, 2));

            if (verifyData.success) {
                console.log('\n✅ OTP Verification successful!');
                console.log(`👤 User: ${verifyData.user.email}`);
                console.log(`🎫 Token: ${verifyData.token.substring(0, 20)}...`);
            } else {
                console.log('\n❌ OTP Verification failed:', verifyData.message);
            }

        } else {
            console.log('\n❌ Registration failed:', registerData.message);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
    }

    console.log('\n=== Test Complete ===');
}

// Run the test
testRegistrationFlow();
