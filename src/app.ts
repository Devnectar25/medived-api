import express, { Request, Response } from 'express';
import cors from 'cors';

import productRoutes from './routes/productRoutes';
import brandRoutes from './routes/brandRoutes';

const app = express();

app.use(cors());
app.use(express.json());

// ⭐ IMPORTANT — Attach API route
app.use('/api/products', productRoutes);
app.use('/api/brands', brandRoutes);

app.get('/', (req: Request, res: Response) => {
    res.send("HomeVed API is running...");
});

export default app;
