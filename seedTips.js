const pool = require('./src/config/db');

const tips = [
    {
        title: '10 Essential Homeopathic Remedies for Every Medicine Cabinet',
        excerpt: 'Learn about the must-have homeopathic remedies that can help address common health concerns naturally...',
        image: 'https://via.placeholder.com/800x450',
        date: 'March 15, 2024',
        read_time: '5 min read',
        author: 'Dr. Priya Sharma',
        category: 'Homeopathy',
        content: {
            introduction: 'Homeopathy offers gentle, natural solutions for many common health concerns. Having a well-stocked homeopathic medicine cabinet can help you address minor ailments quickly and effectively. Here are ten essential remedies that every household should have on hand.',
            sections: [
                { heading: '1. Arnica Montana - The Trauma Remedy', content: 'Arnica is the go-to remedy for physical trauma, bruises, and muscle soreness.' },
                { heading: '2. Nux Vomica - Digestive Relief', content: 'This remedy is invaluable for digestive issues caused by overindulgence, stress, or irregular eating habits.' }
            ],
            conclusion: 'These remedies form the foundation of a comprehensive homeopathic first-aid kit.'
        }
    },
    {
        title: 'Ayurvedic Diet Tips for Better Digestion and Health',
        excerpt: 'Discover ancient Ayurvedic wisdom on nutrition and how to optimize your digestive health through mindful eating...',
        image: 'https://images.unsplash.com/photo-1607619056574-7b8d3ee536b2?q=80&w=800',
        date: 'March 12, 2024',
        read_time: '7 min read',
        author: 'Dr. Rajesh Kumar',
        category: 'Ayurveda',
        content: {
            introduction: 'Ayurveda, the ancient Indian system of medicine, places great emphasis on digestion as the cornerstone of good health.',
            sections: [
                { heading: 'Understanding Agni - Your Digestive Fire', content: 'In Ayurveda, Agni refers to the digestive fire that transforms food into energy and nutrients.' }
            ],
            conclusion: 'By incorporating these Ayurvedic dietary principles into your daily life, you can significantly improve your digestion.'
        }
    }
];

(async () => {
    try {
        for (const t of tips) {
            await pool.query(
                'INSERT INTO health_tips (title, excerpt, image, date, read_time, author, category, content) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [t.title, t.excerpt, t.image, t.date, t.read_time, t.author, t.category, t.content]
            );
        }
        console.log('Database seeded with health tips');
        process.exit(0);
    } catch (err) {
        console.error('Seeding error:', err);
        process.exit(1);
    }
})();
