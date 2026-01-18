// Test script for authentication flow
const API_BASE = 'http://localhost:4000/api';

async function testAuthFlow() {
    console.log('=== Testing Authentication Flow ===\n');

    // Test 1: Login
    console.log('1. Testing Login...');
    try {
        const loginResponse = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'test@example.com',
                password: 'Test@1234'
            })
        });

        const loginData = await loginResponse.json();
        console.log('Login Response:', JSON.stringify(loginData, null, 2));

        if (loginData.success && loginData.requires2FA) {
            console.log('\n✅ Login successful - 2FA required');
            console.log(`📧 Email: ${loginData.email}`);
            console.log(`🔑 OTP: ${loginData.otp}`);

            // Test 2: Verify OTP
            console.log('\n2. Testing OTP Verification...');

            // Test with correct OTP
            const verifyResponse = await fetch(`${API_BASE}/auth/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: loginData.email,
                    otp: loginData.otp
                })
            });

            const verifyData = await verifyResponse.json();
            console.log('Verify Response:', JSON.stringify(verifyData, null, 2));

            if (verifyData.success) {
                console.log('\n✅ OTP Verification successful!');
                console.log(`👤 User: ${verifyData.user.email}`);
                console.log(`🎫 Token: ${verifyData.token.substring(0, 20)}...`);
            } else {
                console.log('\n❌ OTP Verification failed:', verifyData.message);
            }

            // Test 3: Test with wrong OTP
            console.log('\n3. Testing with wrong OTP...');
            const wrongOtpResponse = await fetch(`${API_BASE}/auth/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: loginData.email,
                    otp: '000000'
                })
            });

            const wrongOtpData = await wrongOtpResponse.json();
            console.log('Wrong OTP Response:', JSON.stringify(wrongOtpData, null, 2));

            // Test 4: Test with missing fields
            console.log('\n4. Testing with missing email...');
            const missingEmailResponse = await fetch(`${API_BASE}/auth/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    otp: '123456'
                })
            });

            const missingEmailData = await missingEmailResponse.json();
            console.log('Missing Email Response:', JSON.stringify(missingEmailData, null, 2));

        } else {
            console.log('\n❌ Login failed or no 2FA required:', loginData.message);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    console.log('\n=== Test Complete ===');
}

// Run the test
testAuthFlow();
