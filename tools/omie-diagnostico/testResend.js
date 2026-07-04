const { Resend } = require('resend');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, 'server', '.env') });

const resend = new Resend(process.env.RESEND_API_KEY);

async function test() {
    console.log('Using API Key:', process.env.RESEND_API_KEY ? 'Present' : 'Missing');
    try {
        const { data, error } = await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: process.env.DEV_EMAIL_OVERRIDE || 'delivered@resend.dev',
            subject: 'Test Resend API',
            html: '<p>Testing connection from server</p>'
        });

        if (error) {
            console.log('Resend Error Object:', JSON.stringify(error, null, 2));
        } else {
            console.log('Resend Success:', data);
        }
    } catch (err) {
        console.error('Thrown Error:', err);
    }
}

test();
