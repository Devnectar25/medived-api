// Comprehensive test for all OTP verification scenarios
const API_BASE = 'http://localhost:4000/api';

async function runAllTests() {
    console.log('=== Comprehensive OTP Verification Tests ===\n');

    const testEmail = `test${Date.now()}@example.com`;
    const testPassword = 'Test@1234';
    let savedOtp = '';

    // Test 1: Registration
    console.log('📝 Test 1: Registration');
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
        if (registerData.success && registerData.otp) {
            savedOtp = registerData.otp;
            console.log(`✅ Registration successful - OTP: ${savedOtp}\n`);
        } else {
            console.log(`❌ Registration failed: ${registerData.message}\n`);
            return;
        }
    } catch (error) {
        console.error(`❌ Error: ${error.message}\n`);
        return;
    }

    // Test 2: Verify with missing email
    console.log('📝 Test 2: Verify OTP with missing email');
    try {
        const response = await fetch(`${API_BASE}/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ otp: savedOtp })
        });
        const data = await response.json();
        if (!data.success && data.message.includes('required')) {
            console.log(`✅ Correctly rejected - ${data.message}\n`);
        } else {
            console.log(`❌ Should have rejected missing email\n`);
        }
    } catch (error) {
        console.error(`❌ Error: ${error.message}\n`);
    }

    // Test 3: Verify with missing OTP
    console.log('📝 Test 3: Verify OTP with missing OTP');
    try {
        const response = await fetch(`${API_BASE}/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail })
        });
        const data = await response.json();
        if (!data.success && data.message.includes('required')) {
            console.log(`✅ Correctly rejected - ${data.message}\n`);
        } else {
            console.log(`❌ Should have rejected missing OTP\n`);
        }
    } catch (error) {
        console.error(`❌ Error: ${error.message}\n`);
    }

    // Test 4: Verify with wrong OTP
    console.log('📝 Test 4: Verify OTP with wrong code');
    try {
        const response = await fetch(`${API_BASE}/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, otp: '000000' })
        });
        const data = await response.json();
        if (!data.success && data.message.includes('Invalid')) {
            console.log(`✅ Correctly rejected - ${data.message}\n`);
        } else {
            console.log(`❌ Should have rejected wrong OTP\n`);
        }
    } catch (error) {
        console.error(`❌ Error: ${error.message}\n`);
    }

    // Test 5: Verify with correct OTP
    console.log('📝 Test 5: Verify OTP with correct code');
    try {
        const response = await fetch(`${API_BASE}/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, otp: savedOtp })
        });
        const data = await response.json();
        if (data.success && data.user && data.token) {
            console.log(`✅ Successfully verified!`);
            console.log(`   User: ${data.user.email}`);
            console.log(`   Token: ${data.token.substring(0, 30)}...\n`);
        } else {
            console.log(`❌ Verification failed: ${data.message}\n`);
        }
    } catch (error) {
        console.error(`❌ Error: ${error.message}\n`);
    }

    // Test 6: Try to use OTP again (should fail - already used)
    console.log('📝 Test 6: Try to reuse OTP (should fail)');
    try {
        const response = await fetch(`${API_BASE}/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, otp: savedOtp })
        });
        const data = await response.json();
        if (!data.success && data.message.includes('not requested')) {
            console.log(`✅ Correctly rejected - ${data.message}\n`);
        } else {
            console.log(`❌ Should have rejected reused OTP\n`);
        }
    } catch (error) {
        console.error(`❌ Error: ${error.message}\n`);
    }

    console.log('=== All Tests Complete ===');
}

// Run all tests
runAllTests();
