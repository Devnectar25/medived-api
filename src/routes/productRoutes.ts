import express from 'express';
import { ProductController } from '../controllers/productController';

const router = express.Router();

// GET /api/products
router.get('/', ProductController.getProducts);

// GET /api/products/:id
router.get('/:id', ProductController.getProduct);

export default router;
